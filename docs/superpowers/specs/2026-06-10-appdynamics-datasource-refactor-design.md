# AppDynamics Grafana Data Source — Full Refactor + New Features Design

Date: 2026-06-10
Branch: `feat/refactor`
Status: Approved for implementation (autonomous run; 3 rounds of write + review)

## 1. Background

The current plugin is a minimal frontend-only Grafana data source:

- One hard-coded REST call (`/controller/rest/applications/{app}/metric-data`) per target.
- `convertMetricData` only reads `data[0]` — **wildcard metric paths silently drop all series but the first**.
- Free-text `Application` and `Query` inputs using deprecated `LegacyForms.FormField`; class components.
- Deprecated `backendSrv.datasourceRequest()`.
- No template variables, no annotations, no metric browsing, no events, no legend aliasing.
- `plugin.json` references `img/logo.svg` which does not exist.

## 2. Research findings (AppDynamics REST API)

Verified against Splunk AppDynamics docs (25.x/26.x, SaaS + on-prem):

### 2.1 Metric data

`GET /controller/rest/applications/{application}/metric-data`
(Newer docs name this `metric-data-v2`; the classic `metric-data` path is what the
current plugin uses in production and remains backward compatible with older
on-prem controllers — **we keep `metric-data`**.)

Params:

- `metric-path` — pipe-delimited hierarchy path; `*` wildcard per segment.
- `time-range-type` — `BEFORE_NOW | BEFORE_TIME | AFTER_TIME | BETWEEN_TIMES`.
- `start-time`, `end-time` (epoch ms), `duration-in-mins` (per range type; we use `BETWEEN_TIMES` + start/end).
- `rollup` — `true` (default) aggregates to a single value; `false` returns full resolution.
- `output=JSON`.

Response: **array** of series:

```json
[
  {
    "metricId": 2339,
    "metricName": "BTM|Application Summary|Average Response Time (ms)",
    "metricPath": "Overall Application Performance|Average Response Time (ms)",
    "frequency": "ONE_MIN",
    "metricValues": [
      {
        "startTimeInMillis": 1700000000000,
        "value": 5,
        "min": 1,
        "max": 10,
        "current": 4,
        "sum": 50,
        "count": 10,
        "occurrences": 1,
        "standardDeviation": 0,
        "useRange": true
      }
    ]
  }
]
```

A wildcard path returns multiple array entries — one per concrete metric.

### 2.2 Metric hierarchy (browse)

`GET /controller/rest/applications/{application}/metrics?metric-path=...&output=JSON`
→ array of `{ "name": string, "type": "folder" | "leaf" }`. Empty `metric-path` lists roots.

### 2.3 Application model

- `GET /controller/rest/applications` → `[{ id, name, ... }]`
- `GET /controller/rest/applications/{app}/tiers` → `[{ id, name, ... }]`
- `GET /controller/rest/applications/{app}/nodes` → `[{ id, name, tierName, ... }]`
- `GET /controller/rest/applications/{app}/business-transactions` → `[{ id, name, tierName, entryPointType, ... }]`
  All with `output=json`.

### 2.4 Events

`GET /controller/rest/applications/{app}/events`
Params: time-range params (as above) + `event-types` (comma-separated, e.g.
`APPLICATION_ERROR, APPLICATION_CRASH, DIAGNOSTIC_SESSION, CUSTOM, STALL,
DEADLOCK, RESOURCE_POOL_LIMIT, APPLICATION_DEPLOYMENT, AGENT_EVENT,
POLICY_OPEN_WARNING, POLICY_OPEN_CRITICAL, POLICY_CLOSE_WARNING, POLICY_CLOSE_CRITICAL`)

- `severities` (`INFO,WARN,ERROR`). Max 600 events per request.
  Response item: `{ id, type, subType, eventTime, severity, summary, deepLinkUrl,
affectedEntities: [{entityType, name, entityId}], triggeredEntity, ... }`.

### 2.5 Health rule violations

`GET /controller/rest/applications/{app}/problems/healthrule-violations`
Same time-range params. Response item:
`{ id, name, startTimeInMillis, detectedTimeInMillis, endTimeInMillis,
incidentStatus (OPEN|RESOLVED|...), severity (WARNING|CRITICAL),
affectedEntityDefinition, triggeredEntityDefinition, deepLinkUrl, description? }`.

### 2.6 Auth

Через Grafana data source proxy (`instanceSettings.url`) — Basic auth
`username@account : password`, configured in standard HTTP settings. No change needed.

## 3. Goals

1. **Full refactor**: modern Grafana 12 plugin idioms — `getBackendSrv().fetch()` (Observable + `lastValueFrom`), `createDataFrame`, function components, non-legacy `@grafana/ui` controls, layered architecture, typed API client.
2. **Fix bugs**: multi-series wildcard responses (all series, not `data[0]`); missing logo; brittle `getFilteredNames` matching.
3. **New features**:
   - F1 Application dropdown (async, allows variables/custom values).
   - F2 Metric path browser — cascading segment selects from `/metrics`, with raw-edit mode for wildcards/variables.
   - F3 Template variables — `metricFindQuery` (applications / tiers / nodes / businessTransactions / metric path children) + dedicated variable query editor; variable interpolation in application + metric path (multi-value expands to one query per value).
   - F4 Query types — `metrics` (timeseries), `events` (table/annotation frames), `healthRuleViolations` (table/annotation frames).
   - F5 Annotations support (`plugin.json: "annotations": true`, default annotation processor; events/HRV queries emit `time/timeEnd/title/text/tags` fields).
   - F6 Legend alias templates: `{{application}}`, `{{metricPath}}`, `{{metricName}}`, `{{N}}` (Nth path segment).
   - F7 Rollup toggle + stat field selection (`value|min|max|sum|count|current`).
   - F8 Friendly `testDatasource` diagnostics (401/403/404/network hints).
   - F9 Backward-compatible query migration (`queryText` → `metricPath`, defaults filled).

Out of scope: Go backend (alerting), OAuth client-credentials flow, Analytics Events API.

## 4. Architecture

```
src/
  module.ts                  plugin entry (unchanged role)
  plugin.json                + "annotations": true, logo fix
  types.ts                   ALL shared contracts (query model, options, API DTOs)
  migrations.ts              migrateQuery(legacy → current)
  api/
    client.ts                AppDynamicsClient — thin typed REST wrapper, owns URLs/encoding/errors
  datasource.ts              DataSource extends DataSourceApi
                               query / testDatasource / metricFindQuery / annotations
                               variable interpolation; response → DataFrame conversion
  components/
    ConfigEditor.tsx         DataSourceHttpSettings + auth hint (user@account)
    QueryEditor.tsx          function component; per-queryType sub-editors
    MetricPathBrowser.tsx    cascading segment Selects + raw-edit toggle
    VariableQueryEditor.tsx  structured variable queries
  __tests__/                 unit tests per module
```

Data flow: Editor → `AppDynamicsQuery` → `DataSource.query()` → interpolate vars →
`AppDynamicsClient` (fetch via Grafana proxy) → DTOs → frames (`createDataFrame`).

### 4.1 Contracts (`src/types.ts`) — written first, agents code against it

```ts
import { DataQuery, DataSourceJsonData } from '@grafana/data';

export type AppDynamicsQueryType = 'metrics' | 'events' | 'healthRuleViolations';
export type MetricStatField = 'value' | 'min' | 'max' | 'sum' | 'count' | 'current';
export type EventSeverity = 'INFO' | 'WARN' | 'ERROR';

export interface AppDynamicsQuery extends DataQuery {
  queryType?: AppDynamicsQueryType; // default 'metrics' (migration fills)
  application?: string;
  metricPath?: string; // '*' wildcards + $variables
  rollup?: boolean; // default false
  dataField?: MetricStatField; // default 'value'
  alias?: string; // legend template
  eventTypes?: string[]; // events query
  severities?: EventSeverity[]; // events query
  /** @deprecated legacy fields, consumed by migrateQuery */
  queryText?: string;
  host?: string;
  metricSegments?: string[];
}

export interface AppDynamicsOptions extends DataSourceJsonData {}

export interface AppDynamicsVariableQuery {
  queryType: 'applications' | 'tiers' | 'nodes' | 'businessTransactions' | 'metrics';
  application?: string; // required except for 'applications'
  metricPath?: string; // for 'metrics': list children of this path
  /** raw string form kept for dashboards that stored plain strings */
  rawQuery?: string;
}

// --- AppDynamics REST DTOs ---
export interface AppDynamicsEntity {
  id: number;
  name: string;
}
export interface AppDynamicsNode extends AppDynamicsEntity {
  tierName?: string;
  machineName?: string;
}
export interface AppDynamicsBusinessTransaction extends AppDynamicsEntity {
  tierName?: string;
  entryPointType?: string;
}
export interface MetricTreeItem {
  name: string;
  type: 'folder' | 'leaf';
}
export interface MetricValue {
  startTimeInMillis: number;
  value: number;
  min?: number;
  max?: number;
  current?: number;
  sum?: number;
  count?: number;
  occurrences?: number;
  standardDeviation?: number;
  useRange?: boolean;
}
export interface MetricSeries {
  metricId?: number;
  metricName?: string;
  metricPath?: string;
  frequency?: string;
  metricValues?: MetricValue[];
}
export interface AppDynamicsEntityRef {
  entityType?: string;
  entityId?: number;
  name?: string;
}
export interface AppDynamicsEvent {
  id: number;
  type?: string;
  subType?: string;
  eventTime: number;
  severity?: EventSeverity;
  summary?: string;
  deepLinkUrl?: string;
  affectedEntities?: AppDynamicsEntityRef[];
  triggeredEntity?: AppDynamicsEntityRef;
}
export interface HealthRuleViolation {
  id: number;
  name?: string;
  startTimeInMillis: number;
  endTimeInMillis?: number;
  detectedTimeInMillis?: number;
  incidentStatus?: string;
  severity?: string;
  description?: string;
  deepLinkUrl?: string;
  affectedEntityDefinition?: AppDynamicsEntityRef;
  triggeredEntityDefinition?: AppDynamicsEntityRef;
}
```

`defaultQuery: Partial<AppDynamicsQuery> = { queryType: 'metrics', rollup: false, dataField: 'value' }`.

### 4.2 API client (`src/api/client.ts`)

Constructor takes `(baseUrl, backendSrv = getBackendSrv())`. One private
`request<T>(path, params)` → `lastValueFrom(fetch<T>(...))`, `output: 'json'`
always appended; **encodeURIComponent on path segments** (application names with
spaces/slashes); normalized error messages (`FetchError` → status-aware text).
Public methods (all return parsed DTO arrays, tolerate non-array payloads by
returning `[]`):
`getApplications, getTiers, getNodes, getBusinessTransactions, browseMetrics(app, parentPath), getMetricData(app, metricPath, fromMs, toMs, rollup), getEvents(app, fromMs, toMs, eventTypes, severities), getHealthRuleViolations(app, fromMs, toMs)`.

Events default when none selected: `eventTypes = [APPLICATION_ERROR, APPLICATION_CRASH, STALL, DEADLOCK]`, `severities = [INFO, WARN, ERROR]` (API requires both params).

### 4.3 DataSource (`src/datasource.ts`)

- `query()`: filter empty targets (`filterQuery`), migrate each target, interpolate
  `application`/`metricPath`/`eventTypes` via `getTemplateSrv().replace(..., scopedVars)`;
  multi-value variables in `metricPath` expand to multiple concrete paths (format
  callback collecting values), one request each; run all targets in parallel
  (`Promise.all`); per metric series returned → one frame: `Time` field +
  number field (name = alias rendered or `metricPath`), `dataField` selects stat,
  skip null stats. `refId` preserved. Config `frame.meta.preferredVisualisationType`:
  'graph' for metrics, 'table' for events/HRV.
- Events frames: fields `time (eventTime), title (type/subType), text (summary),
tags (severity + affected entity names), id, deepLinkUrl`.
- HRV frames: `time (startTimeInMillis), timeEnd (endTimeInMillis when resolved),
title (name), text (description/affected entity), tags (severity, incidentStatus), deepLinkUrl`.
- `annotations = {}` → default annotation support; annotation queries reuse the
  normal query editor; events/HRV frames already annotation-shaped.
- `metricFindQuery(query, options)`: accepts `AppDynamicsVariableQuery` object or
  legacy/raw string (`applications`, `tiers(App)`, `nodes(App)`,
  `businessTransactions(App)`, `metrics(App, Parent|Path)`); parse → client call →
  `MetricFindValue[]` (`{ text, value }`); folders AND leaves both listed for
  `metrics` (folder names useful as path segments).
- `testDatasource()`: `getApplications()`; success → `Success: connected, N
applications visible`; 401/403 → credentials hint (user@account); other →
  status + message.
- `getDefaultQuery()`, `filterQuery(q)` (metrics need app+path; events/HRV need app).

### 4.4 Components

- **QueryEditor** (fn component): query-type `RadioButtonGroup`; Application
  `Select` backed by `useAsyncApplications` hook (loading state, allowCustomValue
  so `$variables` typeable); metrics → `MetricPathBrowser` + alias `Input` +
  rollup `InlineSwitch` + stat `Select`; events → eventTypes `MultiSelect`
  (allowCustomValue) + severities `MultiSelect`; HRV → app only.
- **MetricPathBrowser**: controlled by `metricPath` string. Cascade of `Select`s,
  one per segment; options = `browseMetrics(app, joined-prefix)`; choosing a
  folder appends a new pending select; choosing a leaf terminates; `*` injected
  as an always-available option per level; "Edit raw" toggle ↔ `Input` for
  variables/hand-written wildcards. Debounced/cached per prefix (simple in-memory
  map per app).
- **ConfigEditor**: keep `DataSourceHttpSettings` (still exported in
  @grafana/ui 12) + `Alert`-style hint about `username@account` Basic auth and
  required controller URL shape.
- **VariableQueryEditor**: Selects for queryType/application (+ metricPath input
  when type=metrics); stores structured object, renders legacy strings.

### 4.5 Error handling

Client normalizes errors; `query()` lets a failed target reject the whole
request? **No** — collect per-target errors: failed target → empty frame +
`meta.notices`/throw only if ALL targets fail; (keep simple: `Promise.all` with
per-target try/catch, attach error frames `{ refId, error }` via
`DataQueryResponse.errors`). testDatasource never throws raw FetchError.

### 4.6 Testing strategy

Jest + @swc/jest (existing setup), @testing-library/react for components.

- client: URL building/encoding/params/error mapping (mock backendSrv.fetch → of(...)).
- datasource: migration, multi-series frames, dataField, alias, variable expansion
  (mock templateSrv), metricFindQuery parsing matrix, events/HRV frame shape,
  testDatasource matrix.
- components: render + interaction smoke tests (QueryEditor switches sub-editors;
  MetricPathBrowser cascades; VariableQueryEditor emits structured query).
  Existing `src/__tests__/datasource.test.ts` is rewritten for the new API.

## 5. Execution plan (user-mandated: 2 Claude + 2 Codex agents, 3 rounds)

- **Foundation (orchestrator)**: this doc + `src/types.ts` + `src/migrations.ts` committed first as the shared contract.
- **Round 1 — write**: Claude Agent A: `api/client.ts`, `datasource.ts`, `module.ts`, `plugin.json`, core tests. Claude Agent B: all `components/`, `img/logo.svg`, component tests. Disjoint file ownership; both code against `types.ts`.
- **Round 1 — review**: Codex Agent 1: architecture + AppD API correctness (vs §2 facts). Codex Agent 2: bugs/code quality/test gaps.
- **Round 2 — write**: A/B fix findings + close gaps. **Round 2 — review**: Codex 1+2 re-review diff.
- **Round 3 — write+verify**: final fixes; `npm run build && test:ci && lint && typecheck`; Codex final verdict; commit.

## 6. Decisions log

- Keep `/metric-data` (not `-v2`): backward compat with on-prem controllers; current production behavior.
- Frontend-only plugin retained (no Go backend): alerting via frontend DS not available anyway without major scope increase.
- `DataSourceHttpSettings` retained despite deprecation notice: avoids new `@grafana/plugin-ui` dependency; still the OSS-standard config UI in Grafana 12.
- `MutableDataFrame` → `createDataFrame` (MutableDataFrame deprecated in @grafana/data 12).
- Multi-value variables expand client-side into N requests (AppD wildcard syntax has no `{a,b}` alternation).

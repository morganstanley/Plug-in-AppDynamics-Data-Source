// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import {
  createDataFrame,
  dateMath,
  DataSourceApi,
  FieldType,
  type CoreApp,
  type DataFrame,
  type DataQueryError,
  type DataQueryRequest,
  type DataQueryResponse,
  type DataSourceInstanceSettings,
  type DateTime,
  type LegacyMetricFindQueryOptions,
  type MetricFindValue,
  type ScopedVars,
  type TestDataSourceResponse,
} from '@grafana/data';
import { getBackendSrv, getTemplateSrv, type BackendSrv, type TemplateSrv } from '@grafana/runtime';

import { AppDynamicsApiError, AppDynamicsClient } from './api/client';
import { migrateQuery } from './migrations';
import {
  AppDynamicsEntity,
  AppDynamicsEvent,
  AppDynamicsOptions,
  AppDynamicsQuery,
  AppDynamicsVariableQuery,
  DEFAULT_QUERY,
  HealthRuleViolation,
  MetricSeries,
  MetricTreeItem,
} from './types';

/** Context available to legend alias templates. */
export interface AliasContext {
  application?: string;
  metricPath?: string;
  metricName?: string;
}

/**
 * Renders a legend alias template. Supported tokens: `{{application}}`,
 * `{{metricPath}}`, `{{metricName}}` and `{{N}}` — the Nth pipe-delimited
 * segment of the metric path (1-based).
 */
export function renderAlias(alias: string, context: AliasContext): string {
  const segments = (context.metricPath ?? '').split('|');
  return alias.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    if (/^\d+$/.test(token)) {
      return segments[Number(token) - 1] ?? '';
    }
    switch (token) {
      case 'application':
        return context.application ?? '';
      case 'metricPath':
        return context.metricPath ?? '';
      case 'metricName':
        return context.metricName ?? '';
      default:
        return match;
    }
  });
}

// Multi-value variables are encoded structurally: the values are JSON-encoded
// between two control-character markers. Control characters cannot appear in
// AppDynamics application/metric names (and JSON.stringify escapes them inside
// the payload), so the markers can never collide with real data — unlike a
// textual `{a,b}` grammar, which corrupts values containing commas or braces.
const VARIANTS_START = '\u0001';
const VARIANTS_END = '\u0002';

/**
 * `templateSrv.replace()` format callback for application/metric path fields.
 * Single values are inserted verbatim; multi-value selections become an
 * encoded alternation that {@link expandMetricPathVariants} expands.
 */
export function formatMultiValueVariable(value: string | string[]): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }
    if (value.length === 1) {
      return String(value[0]);
    }
    return `${VARIANTS_START}${JSON.stringify(value.map(String))}${VARIANTS_END}`;
  }
  return String(value);
}

/**
 * Expands encoded multi-value alternations (see {@link formatMultiValueVariable})
 * into every concrete combination — `x|<a,b>|<c,d>` yields four strings, and
 * values containing commas, braces or parentheses survive intact. Strings
 * without markers are returned as-is. Used for both metric paths and
 * application names.
 */
export function expandMetricPathVariants(path: string): string[] {
  const start = path.indexOf(VARIANTS_START);
  if (start === -1) {
    return [path];
  }
  const end = path.indexOf(VARIANTS_END, start + 1);
  if (end === -1) {
    return [path];
  }
  let alternatives: string[];
  try {
    const parsed: unknown = JSON.parse(path.slice(start + 1, end));
    alternatives = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    // Not a payload produced by formatMultiValueVariable — pass through untouched.
    return [path];
  }
  const prefix = path.slice(0, start);
  // Recurse only on the remainder of the ORIGINAL string. Decoded alternatives
  // are literal values and are never re-scanned, so a value that itself
  // contains marker characters survives expansion byte-identical.
  const suffixes = expandMetricPathVariants(path.slice(end + 1));
  return alternatives.flatMap((alternative) => suffixes.map((suffix) => prefix + alternative + suffix));
}

/**
 * Parses legacy/raw string variable queries:
 * `applications`, `tiers(App)`, `nodes(App)`, `businessTransactions(App)`
 * (alias `bts(App)`) and `metrics(App, Parent|Path)`.
 *
 * Known limitation: in the `metrics(App, Path)` form the application name is
 * everything before the FIRST comma, so application names that themselves
 * contain a comma mis-parse. Use the structured variable query editor for
 * such applications — the structured object form has no such ambiguity.
 */
export function parseVariableQuery(raw: string): AppDynamicsVariableQuery | undefined {
  const trimmed = raw.trim();
  if (/^applications$/i.test(trimmed)) {
    return { queryType: 'applications' };
  }
  // Match up to the LAST closing paren: metric paths legitimately contain ')', e.g. "Average Response Time (ms)".
  const match = /^(tiers|nodes|businessTransactions|bts|metrics)\s*\((.*)\)\s*$/is.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const fn = match[1].toLowerCase();
  const args = match[2];
  if (fn === 'metrics') {
    // Split on the first comma only: the remainder is the (comma-tolerant) metric path.
    const commaIndex = args.indexOf(',');
    const application = (commaIndex === -1 ? args : args.slice(0, commaIndex)).trim();
    const metricPath = commaIndex === -1 ? '' : args.slice(commaIndex + 1).trim();
    return { queryType: 'metrics', application, metricPath };
  }
  const application = args.trim();
  if (fn === 'tiers') {
    return { queryType: 'tiers', application };
  }
  if (fn === 'nodes') {
    return { queryType: 'nodes', application };
  }
  return { queryType: 'businessTransactions', application };
}

function toDataQueryError(error: unknown, refId: string, context?: string): DataQueryError {
  const base = error instanceof Error ? error.message : String(error);
  const queryError: DataQueryError = {
    refId,
    message: context ? `${base} (${context})` : base,
  };
  if (error instanceof AppDynamicsApiError && error.status !== undefined) {
    queryError.status = error.status;
  }
  return queryError;
}

/** Frames and per-path errors produced by a single target. */
interface TargetResult {
  frames: DataFrame[];
  errors: DataQueryError[];
}

export class DataSource extends DataSourceApi<AppDynamicsQuery, AppDynamicsOptions> {
  private readonly client: AppDynamicsClient;
  private readonly templateSrv: TemplateSrv;

  constructor(
    instanceSettings: DataSourceInstanceSettings<AppDynamicsOptions>,
    backendSrv: BackendSrv = getBackendSrv(),
    templateSrv: TemplateSrv = getTemplateSrv()
  ) {
    super(instanceSettings);
    this.client = new AppDynamicsClient(instanceSettings.url ?? '', backendSrv);
    this.templateSrv = templateSrv;
    // Default annotation support: annotation queries reuse the regular query
    // editor and the events/health rule violation frames are annotation-shaped.
    this.annotations = {};
  }

  // --- convenience API used by the editor components ---

  async getApplications(): Promise<AppDynamicsEntity[]> {
    return this.client.getApplications();
  }

  async browseMetricPath(application: string, parentPath?: string): Promise<MetricTreeItem[]> {
    return this.client.browseMetrics(application, parentPath);
  }

  // --- DataSourceApi ---

  async query(request: DataQueryRequest<AppDynamicsQuery>): Promise<DataQueryResponse> {
    const fromMs = this.toEpochMillis(request.range.from);
    const toMs = this.toEpochMillis(request.range.to);

    const targets = request.targets
      .map((target) => migrateQuery(target))
      .filter((target) => !target.hide && this.filterQuery(target));

    const data: DataFrame[] = [];
    const errors: DataQueryError[] = [];

    await Promise.all(
      targets.map(async (target) => {
        try {
          const result = await this.runTarget(target, request.scopedVars, fromMs, toMs);
          data.push(...result.frames);
          errors.push(...result.errors);
        } catch (error) {
          errors.push(toDataQueryError(error, target.refId));
        }
      })
    );

    return errors.length > 0 ? { data, errors } : { data };
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    try {
      const applications = await this.client.getApplications();
      return {
        status: 'success',
        message: `Successfully connected: ${applications.length} application(s) visible`,
      };
    } catch (error) {
      const status = error instanceof AppDynamicsApiError ? error.status : undefined;
      if (status === 401 || status === 403) {
        return {
          status: 'error',
          message:
            `Authentication failed (HTTP ${status}). Check the Basic auth credentials — ` +
            'the user name must be in the form username@account.',
        };
      }
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async metricFindQuery(
    query: AppDynamicsVariableQuery | string,
    options?: LegacyMetricFindQueryOptions
  ): Promise<MetricFindValue[]> {
    const structured = typeof query === 'string' ? parseVariableQuery(query) : query;
    if (typeof query === 'string' && structured === undefined) {
      if (query.trim() === '') {
        return [];
      }
      throw new Error(
        `Unrecognized variable query "${query}". Supported: applications, tiers(App), nodes(App), ` +
          'businessTransactions(App), metrics(App, Parent|Path).'
      );
    }
    if (!structured) {
      return [];
    }

    const scopedVars = options?.scopedVars;
    const application = this.templateSrv.replace(structured.application ?? '', scopedVars);
    const toFindValue = (entity: AppDynamicsEntity): MetricFindValue => ({ text: entity.name, value: entity.name });

    switch (structured.queryType) {
      case 'applications':
        return (await this.client.getApplications()).map(toFindValue);
      case 'tiers':
        return (await this.client.getTiers(application)).map(toFindValue);
      case 'nodes':
        return (await this.client.getNodes(application)).map(toFindValue);
      case 'businessTransactions':
        return (await this.client.getBusinessTransactions(application)).map(toFindValue);
      case 'metrics': {
        const metricPath = this.templateSrv.replace(structured.metricPath ?? '', scopedVars);
        const items = await this.client.browseMetrics(application, metricPath === '' ? undefined : metricPath);
        // Folders are useful as path segments too, so both folders and leaves are returned.
        return items.map((item) => ({ text: item.name, value: item.name }));
      }
      default:
        return [];
    }
  }

  getDefaultQuery(_app: CoreApp): Partial<AppDynamicsQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: AppDynamicsQuery): boolean {
    const migrated = migrateQuery(query);
    if (migrated.queryType === 'events' || migrated.queryType === 'healthRuleViolations') {
      return Boolean(migrated.application);
    }
    return Boolean(migrated.application && migrated.metricPath);
  }

  getQueryDisplayText(query: AppDynamicsQuery): string {
    const migrated = migrateQuery(query);
    const application = migrated.application ?? '';
    switch (migrated.queryType) {
      case 'events':
        return `${application}: events`;
      case 'healthRuleViolations':
        return `${application}: health rule violations`;
      default:
        return `${application}: ${migrated.metricPath ?? ''}`;
    }
  }

  // --- per-query-type execution ---

  /** Interpolates a field and expands multi-value variables into concrete values (deduplicated). */
  private expandVariants(raw: string, scopedVars: ScopedVars): string[] {
    const interpolated = this.templateSrv.replace(raw, scopedVars, formatMultiValueVariable);
    return Array.from(new Set(expandMetricPathVariants(interpolated)));
  }

  private async runTarget(
    target: AppDynamicsQuery,
    scopedVars: ScopedVars,
    fromMs: number,
    toMs: number
  ): Promise<TargetResult> {
    // Multi-value variables in the application expand to one query per value.
    const applications = this.expandVariants(target.application ?? '', scopedVars);
    switch (target.queryType) {
      case 'events':
        return this.settlePerApplication(applications, target.refId, (application) =>
          this.runEventsTarget(target, application, scopedVars, fromMs, toMs)
        );
      case 'healthRuleViolations':
        return this.settlePerApplication(applications, target.refId, (application) =>
          this.runHealthRuleViolationsTarget(target, application, fromMs, toMs)
        );
      default:
        return this.runMetricsTarget(target, applications, scopedVars, fromMs, toMs);
    }
  }

  /**
   * Runs one request per application via allSettled so a failing application
   * cannot drop sibling applications' frames; failures become per-application
   * errors naming the application.
   */
  private async settlePerApplication(
    applications: string[],
    refId: string,
    run: (application: string) => Promise<DataFrame>
  ): Promise<TargetResult> {
    const settled = await Promise.allSettled(applications.map(run));
    const frames: DataFrame[] = [];
    const errors: DataQueryError[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        frames.push(result.value);
      } else {
        errors.push(toDataQueryError(result.reason, refId, `application "${applications[index]}"`));
      }
    });
    return { frames, errors };
  }

  private async runMetricsTarget(
    target: AppDynamicsQuery,
    applications: string[],
    scopedVars: ScopedVars,
    fromMs: number,
    toMs: number
  ): Promise<TargetResult> {
    const paths = this.expandVariants(target.metricPath ?? '', scopedVars);
    const multiApp = applications.length > 1;
    const requests = applications.flatMap((application) => paths.map((path) => ({ application, path })));

    // allSettled so one failing path/application cannot drop sibling successes:
    // the target contributes its surviving frames AND a per-path error.
    const settled = await Promise.allSettled(
      requests.map(({ application, path }) =>
        this.client.getMetricData(application, path, fromMs, toMs, target.rollup ?? false)
      )
    );

    const frames: DataFrame[] = [];
    const errors: DataQueryError[] = [];
    settled.forEach((result, index) => {
      const { application, path } = requests[index];
      if (result.status === 'fulfilled') {
        frames.push(...result.value.map((series) => this.metricSeriesToFrame(target, application, series, multiApp)));
      } else {
        const context = multiApp ? `application "${application}", metric path "${path}"` : `metric path "${path}"`;
        errors.push(toDataQueryError(result.reason, target.refId, context));
      }
    });
    return { frames, errors };
  }

  private metricSeriesToFrame(
    target: AppDynamicsQuery,
    application: string,
    series: MetricSeries,
    multiApp: boolean
  ): DataFrame {
    const statField = target.dataField ?? 'value';
    const times: number[] = [];
    const values: number[] = [];

    for (const metricValue of series.metricValues ?? []) {
      const stat = coerceStat(metricValue[statField]);
      if (stat === undefined) {
        continue;
      }
      times.push(metricValue.startTimeInMillis);
      values.push(stat);
    }

    const context: AliasContext = {
      application,
      metricPath: series.metricPath,
      metricName: series.metricName,
    };
    const baseName = series.metricPath ?? series.metricName ?? target.metricPath ?? target.refId;
    // With multiple applications in play the path alone is ambiguous, so the
    // default name carries the application ({{application}} covers aliases).
    const name = target.alias
      ? renderAlias(target.alias, context)
      : multiApp
        ? `${application}: ${baseName}`
        : baseName;

    return createDataFrame({
      refId: target.refId,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        { name, type: FieldType.number, values },
      ],
      meta: { preferredVisualisationType: 'graph' },
    });
  }

  private async runEventsTarget(
    target: AppDynamicsQuery,
    application: string,
    scopedVars: ScopedVars,
    fromMs: number,
    toMs: number
  ): Promise<DataFrame> {
    const eventTypes = this.interpolateList(target.eventTypes, scopedVars);
    const severities = this.interpolateList(target.severities, scopedVars);
    const events = await this.client.getEvents(application, fromMs, toMs, eventTypes, severities);

    return createDataFrame({
      refId: target.refId,
      fields: [
        { name: 'time', type: FieldType.time, values: events.map((event) => event.eventTime) },
        { name: 'title', type: FieldType.string, values: events.map((event) => event.type ?? event.subType ?? '') },
        { name: 'text', type: FieldType.string, values: events.map((event) => event.summary ?? '') },
        { name: 'tags', type: FieldType.other, values: events.map(eventTags) },
        { name: 'id', type: FieldType.string, values: events.map((event) => String(event.id)) },
        { name: 'deepLinkUrl', type: FieldType.string, values: events.map((event) => event.deepLinkUrl ?? '') },
      ],
      meta: { preferredVisualisationType: 'table' },
    });
  }

  private async runHealthRuleViolationsTarget(
    target: AppDynamicsQuery,
    application: string,
    fromMs: number,
    toMs: number
  ): Promise<DataFrame> {
    const violations = await this.client.getHealthRuleViolations(application, fromMs, toMs);

    return createDataFrame({
      refId: target.refId,
      fields: [
        { name: 'time', type: FieldType.time, values: violations.map((v) => v.startTimeInMillis) },
        { name: 'timeEnd', type: FieldType.time, values: violations.map(resolvedEndTime) },
        { name: 'title', type: FieldType.string, values: violations.map((v) => v.name ?? '') },
        {
          name: 'text',
          type: FieldType.string,
          values: violations.map((v) => v.description ?? v.affectedEntityDefinition?.name ?? ''),
        },
        { name: 'tags', type: FieldType.other, values: violations.map(violationTags) },
        { name: 'deepLinkUrl', type: FieldType.string, values: violations.map((v) => v.deepLinkUrl ?? '') },
      ],
      meta: { preferredVisualisationType: 'table' },
    });
  }

  /** Interpolates each entry; multi-value variables are flattened via csv format. */
  private interpolateList(values: string[] | undefined, scopedVars: ScopedVars): string[] {
    return (values ?? [])
      .flatMap((value) => this.templateSrv.replace(value, scopedVars, 'csv').split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private toEpochMillis(value: DateTime | string): number {
    if (typeof value === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- string ranges are legacy behavior mandated by design §4.3; dateMath.parse is the documented parser for them
      const parsed = dateMath.parse(value);
      return Math.ceil(parsed?.valueOf() ?? 0);
    }
    return value.valueOf();
  }
}

// Tags field shape — verified against Grafana's default annotation processor
// (grafana/grafana public/app/features/annotations/standardAnnotationSupport.ts,
// not published to npm, so it cannot be exercised directly in our tests): the
// processor matches the field NAMED 'tags' and splits STRING values on ','
// (`typeof v === 'string'` guard), while ARRAY values pass through untouched
// into AnnotationEvent.tags (string[]). We emit string[] rows (FieldType.other)
// so tag values that themselves contain commas — AppDynamics entity names may —
// can never be corrupted by that split. Table panels render the array form.
function eventTags(event: AppDynamicsEvent): string[] {
  const entityNames = (event.affectedEntities ?? [])
    .map((entity) => entity.name)
    .filter((name): name is string => Boolean(name));
  return [event.severity, ...entityNames].filter((tag): tag is string => Boolean(tag));
}

function violationTags(violation: HealthRuleViolation): string[] {
  return [violation.severity, violation.incidentStatus].filter((tag): tag is string => Boolean(tag));
}

/**
 * Older controllers return metric stats as strings; coerce both forms and
 * drop anything non-finite (null, NaN, Infinity, garbage strings).
 */
function coerceStat(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Open violations report no (or a non-positive) end time; emit null so Grafana treats them as ongoing. */
function resolvedEndTime(violation: HealthRuleViolation): number | null {
  return violation.endTimeInMillis !== undefined && violation.endTimeInMillis > 0 ? violation.endTimeInMillis : null;
}

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

/**
 * Expands `{a,b}` alternations (produced by multi-value template variables)
 * into every concrete combination: `x|{a,b}|{c,d}` yields four paths. A path
 * without braces is returned as-is.
 */
export function expandMetricPathVariants(path: string): string[] {
  const match = /\{([^{}]*)\}/.exec(path);
  if (!match) {
    return [path];
  }
  const prefix = path.slice(0, match.index);
  const suffix = path.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((alternative) => expandMetricPathVariants(prefix + alternative + suffix));
}

/**
 * Parses legacy/raw string variable queries:
 * `applications`, `tiers(App)`, `nodes(App)`, `businessTransactions(App)`
 * (alias `bts(App)`) and `metrics(App, Parent|Path)`.
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

/** Multi-value variables render as `{a,b}` so they can be expanded into concrete metric paths. */
function formatMultiValueVariable(value: string | string[]): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }
    if (value.length === 1) {
      return String(value[0]);
    }
    return `{${value.join(',')}}`;
  }
  return String(value);
}

function toDataQueryError(error: unknown, refId: string): DataQueryError {
  const queryError: DataQueryError = {
    refId,
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof AppDynamicsApiError && error.status !== undefined) {
    queryError.status = error.status;
  }
  return queryError;
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
          data.push(...(await this.runTarget(target, request.scopedVars, fromMs, toMs)));
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

  private async runTarget(
    target: AppDynamicsQuery,
    scopedVars: ScopedVars,
    fromMs: number,
    toMs: number
  ): Promise<DataFrame[]> {
    const application = this.templateSrv.replace(target.application ?? '', scopedVars);
    switch (target.queryType) {
      case 'events':
        return [await this.runEventsTarget(target, application, scopedVars, fromMs, toMs)];
      case 'healthRuleViolations':
        return [await this.runHealthRuleViolationsTarget(target, application, fromMs, toMs)];
      default:
        return this.runMetricsTarget(target, application, scopedVars, fromMs, toMs);
    }
  }

  private async runMetricsTarget(
    target: AppDynamicsQuery,
    application: string,
    scopedVars: ScopedVars,
    fromMs: number,
    toMs: number
  ): Promise<DataFrame[]> {
    const interpolatedPath = this.templateSrv.replace(target.metricPath ?? '', scopedVars, formatMultiValueVariable);
    const paths = Array.from(new Set(expandMetricPathVariants(interpolatedPath)));

    const seriesLists = await Promise.all(
      paths.map((path) => this.client.getMetricData(application, path, fromMs, toMs, target.rollup ?? false))
    );

    return seriesLists.flatMap((seriesList) =>
      seriesList.map((series) => this.metricSeriesToFrame(target, application, series))
    );
  }

  private metricSeriesToFrame(target: AppDynamicsQuery, application: string, series: MetricSeries): DataFrame {
    const statField = target.dataField ?? 'value';
    const times: number[] = [];
    const values: number[] = [];

    for (const metricValue of series.metricValues ?? []) {
      const stat = metricValue[statField];
      if (stat === undefined || stat === null) {
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
    const name = target.alias
      ? renderAlias(target.alias, context)
      : series.metricPath ?? series.metricName ?? target.metricPath ?? target.refId;

    return createDataFrame({
      refId: target.refId,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        { name, type: FieldType.number, values },
      ],
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
        { name: 'tags', type: FieldType.string, values: events.map(eventTags) },
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
        { name: 'tags', type: FieldType.string, values: violations.map(violationTags) },
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
      const parsed = dateMath.parse(value);
      return Math.ceil(parsed?.valueOf() ?? 0);
    }
    return value.valueOf();
  }
}

function eventTags(event: AppDynamicsEvent): string {
  const entityNames = (event.affectedEntities ?? [])
    .map((entity) => entity.name)
    .filter((name): name is string => Boolean(name));
  return [event.severity, ...entityNames].filter(Boolean).join(', ');
}

function violationTags(violation: HealthRuleViolation): string {
  return [violation.severity, violation.incidentStatus].filter(Boolean).join(', ');
}

/** Open violations report no (or a non-positive) end time; emit null so Grafana treats them as ongoing. */
function resolvedEndTime(violation: HealthRuleViolation): number | null {
  return violation.endTimeInMillis !== undefined && violation.endTimeInMillis > 0 ? violation.endTimeInMillis : null;
}

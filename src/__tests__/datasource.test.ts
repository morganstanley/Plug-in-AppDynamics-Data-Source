// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { of, throwError } from 'rxjs';
import { dateTime, type DataQueryRequest, type DataSourceInstanceSettings, type ScopedVars } from '@grafana/data';
import type { BackendSrv, TemplateSrv } from '@grafana/runtime';

import {
  DataSource,
  expandMetricPathVariants,
  formatMultiValueVariable,
  parseVariableQuery,
  renderAlias,
} from '../datasource';
import { AppDynamicsOptions, AppDynamicsQuery, AppDynamicsVariableQuery } from '../types';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  getTemplateSrv: jest.fn(),
}));

const FROM_MS = 1700000000000;
const TO_MS = 1700003600000;

/** Variables known to the mocked template service. */
const VARIABLES: Record<string, string[]> = {
  app: ['MyApp'],
  apps: ['App1', 'App2'],
  tiers: ['tierA', 'tierB'],
  types: ['CUSTOM', 'STALL'],
  // AppDynamics names legitimately contain commas, braces and parentheses.
  nasty: ['BT (checkout, v2)', 'Err{or}s'],
};

type FormatFn = (value: string | string[]) => string;

const applyFormat = (name: string, format?: string | Function): string => {
  const values = VARIABLES[name];
  const value = values.length === 1 ? values[0] : values;
  if (typeof format === 'function') {
    return (format as FormatFn)(value);
  }
  if (format === 'csv') {
    return values.join(',');
  }
  return Array.isArray(value) ? `{${values.join(',')}}` : value;
};

const createTemplateSrv = () => {
  const replace = jest.fn((target?: string, _scopedVars?: ScopedVars, format?: string | Function): string =>
    (target ?? '').replace(/\$(\w+)/g, (match, name: string) => (VARIABLES[name] ? applyFormat(name, format) : match))
  );
  return { replace } as unknown as TemplateSrv & { replace: jest.Mock };
};

interface FetchCall {
  url: string;
  method: string;
  params: Record<string, string | number>;
}

const createDataSource = (fetch: jest.Mock, templateSrv = createTemplateSrv()) => {
  const settings = {
    id: 1,
    uid: 'appd',
    type: 'appdynamics-datasource',
    name: 'AppDynamics',
    jsonData: {},
    url: 'http://proxy',
  } as unknown as DataSourceInstanceSettings<AppDynamicsOptions>;
  const dataSource = new DataSource(settings, { fetch } as unknown as BackendSrv, templateSrv);
  return { dataSource, fetch, templateSrv };
};

const buildRequest = (
  targets: Array<Partial<AppDynamicsQuery>>,
  range: unknown = { from: dateTime(FROM_MS), to: dateTime(TO_MS), raw: { from: 'now-1h', to: 'now' } }
): DataQueryRequest<AppDynamicsQuery> =>
  ({
    targets: targets.map((target, index) => ({ refId: String.fromCharCode(65 + index), ...target })),
    range,
    scopedVars: {},
  }) as unknown as DataQueryRequest<AppDynamicsQuery>;

const fetchParams = (fetch: jest.Mock, call = 0): FetchCall => fetch.mock.calls[call][0];

describe('formatMultiValueVariable + expandMetricPathVariants', () => {
  test('single values pass through unchanged', () => {
    expect(formatMultiValueVariable('plain')).toBe('plain');
    expect(formatMultiValueVariable(['only'])).toBe('only');
    expect(formatMultiValueVariable([])).toBe('');
  });

  test('strings without markers are returned as-is — braces are literal text now', () => {
    expect(expandMetricPathVariants('A|B|C')).toEqual(['A|B|C']);
    expect(expandMetricPathVariants('Tiers|{a,b}|Calls')).toEqual(['Tiers|{a,b}|Calls']);
  });

  test('expands an encoded alternation', () => {
    const path = `Tiers|${formatMultiValueVariable(['a', 'b'])}|Calls`;
    expect(expandMetricPathVariants(path)).toEqual(['Tiers|a|Calls', 'Tiers|b|Calls']);
  });

  test('multiple multi-value variables expand to the full product', () => {
    const path = `${formatMultiValueVariable(['a', 'b'])}|x|${formatMultiValueVariable(['c', 'd'])}`;
    expect(expandMetricPathVariants(path)).toEqual(['a|x|c', 'a|x|d', 'b|x|c', 'b|x|d']);
  });

  test('values containing commas, braces and parentheses survive expansion intact', () => {
    const values = ['Calls, total', 'Err{or}s', 'Average Response Time (ms)', '{a,b}'];
    const path = `Parent|${formatMultiValueVariable(values)}|Leaf`;
    expect(expandMetricPathVariants(path)).toEqual([
      'Parent|Calls, total|Leaf',
      'Parent|Err{or}s|Leaf',
      'Parent|Average Response Time (ms)|Leaf',
      'Parent|{a,b}|Leaf',
    ]);
  });
});

describe('renderAlias', () => {
  const context = { application: 'MyApp', metricPath: 'a|b|c', metricName: 'BTM|x|y' };

  test('replaces named tokens', () => {
    expect(renderAlias('{{application}}: {{metricPath}} ({{metricName}})', context)).toBe('MyApp: a|b|c (BTM|x|y)');
  });

  test('replaces 1-based path segment tokens', () => {
    expect(renderAlias('{{1}}/{{2}}/{{3}}', context)).toBe('a/b/c');
  });

  test('renders empty string for out-of-range segments and missing context', () => {
    expect(renderAlias('{{9}}', context)).toBe('');
    expect(renderAlias('{{metricName}}', { metricPath: 'a' })).toBe('');
  });

  test('tolerates whitespace inside tokens and leaves unknown tokens alone', () => {
    expect(renderAlias('{{ application }} {{nope}}', context)).toBe('MyApp {{nope}}');
  });
});

describe('parseVariableQuery', () => {
  test('parses applications', () => {
    expect(parseVariableQuery('applications')).toEqual({ queryType: 'applications' });
    expect(parseVariableQuery('  Applications  ')).toEqual({ queryType: 'applications' });
  });

  test('parses tiers/nodes/businessTransactions with application argument', () => {
    expect(parseVariableQuery('tiers(My App)')).toEqual({ queryType: 'tiers', application: 'My App' });
    expect(parseVariableQuery('nodes($app)')).toEqual({ queryType: 'nodes', application: '$app' });
    expect(parseVariableQuery('businessTransactions(App)')).toEqual({
      queryType: 'businessTransactions',
      application: 'App',
    });
    expect(parseVariableQuery('bts(App)')).toEqual({ queryType: 'businessTransactions', application: 'App' });
  });

  test('parses metrics with application and parent path split on the first comma', () => {
    expect(parseVariableQuery('metrics(App, Overall|Calls per Minute)')).toEqual({
      queryType: 'metrics',
      application: 'App',
      metricPath: 'Overall|Calls per Minute',
    });
  });

  test('keeps parentheses inside metric paths', () => {
    expect(parseVariableQuery('metrics(App, Perf|Average Response Time (ms))')).toEqual({
      queryType: 'metrics',
      application: 'App',
      metricPath: 'Perf|Average Response Time (ms)',
    });
  });

  test('metrics without a comma lists the roots', () => {
    expect(parseVariableQuery('metrics(App)')).toEqual({ queryType: 'metrics', application: 'App', metricPath: '' });
  });

  test('returns undefined for unrecognized strings', () => {
    expect(parseVariableQuery('whatever(App)')).toBeUndefined();
    expect(parseVariableQuery('')).toBeUndefined();
  });
});

describe('query: metrics', () => {
  const series = (metricPath: string, values: Array<Record<string, unknown>>) => ({
    metricId: 1,
    metricName: `BTM|${metricPath}`,
    metricPath,
    frequency: 'ONE_MIN',
    metricValues: values,
  });

  test('migrates legacy queryText targets and requests with BETWEEN_TIMES', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(buildRequest([{ application: 'App', queryText: 'Legacy|Path' }]));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/App/metric-data');
    expect(fetchParams(fetch).params).toEqual({
      'metric-path': 'Legacy|Path',
      'time-range-type': 'BETWEEN_TIMES',
      'start-time': FROM_MS,
      'end-time': TO_MS,
      rollup: 'false',
      output: 'json',
    });
  });

  test('returns one frame per series so wildcards keep every series', async () => {
    const fetch = jest.fn(() =>
      of({
        data: [
          series('Overall|Calls', [{ startTimeInMillis: 1, value: 10 }]),
          series('Overall|Errors', [{ startTimeInMillis: 1, value: 2 }]),
        ],
      })
    );
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ application: 'App', metricPath: 'Overall|*' }]));

    expect(response.data).toHaveLength(2);
    expect(response.data[0].refId).toBe('A');
    expect(response.data[1].refId).toBe('A');
    expect(response.data[0].fields[1].name).toBe('Overall|Calls');
    expect(response.data[1].fields[1].name).toBe('Overall|Errors');
    expect(response.data[0].fields[0].values).toEqual([1]);
    expect(response.data[0].fields[1].values).toEqual([10]);
    expect(response.data[0].meta?.preferredVisualisationType).toBe('graph');
  });

  test('coerces numeric-string stats and drops non-finite values', async () => {
    const fetch = jest.fn(() =>
      of({
        data: [
          series('Overall|Calls', [
            { startTimeInMillis: 1, value: '12.5' },
            { startTimeInMillis: 2, value: 'NaN' },
            { startTimeInMillis: 3, value: null },
            { startTimeInMillis: 4, value: 'garbage' },
            { startTimeInMillis: 5, value: Infinity },
            { startTimeInMillis: 6, value: '' },
            { startTimeInMillis: 7, value: 7 },
          ]),
        ],
      })
    );
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ application: 'App', metricPath: 'Overall|Calls' }]));

    expect(response.data[0].fields[0].values).toEqual([1, 7]);
    expect(response.data[0].fields[1].values).toEqual([12.5, 7]);
  });

  test('dataField selects the stat and skips entries missing it', async () => {
    const fetch = jest.fn(() =>
      of({
        data: [
          series('Overall|Calls', [
            { startTimeInMillis: 1, value: 10, max: 100 },
            { startTimeInMillis: 2, value: 20 },
            { startTimeInMillis: 3, value: 30, max: 300 },
          ]),
        ],
      })
    );
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(
      buildRequest([{ application: 'App', metricPath: 'Overall|Calls', dataField: 'max' }])
    );

    expect(response.data[0].fields[0].values).toEqual([1, 3]);
    expect(response.data[0].fields[1].values).toEqual([100, 300]);
  });

  test('renders alias templates including {{N}} segments', async () => {
    const fetch = jest.fn(() => of({ data: [series('a|b|c', [{ startTimeInMillis: 1, value: 1 }])] }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(
      buildRequest([
        {
          application: '$app',
          metricPath: 'a|b|c',
          alias: '{{application}} - {{2}} - {{metricName}}',
        },
      ])
    );

    expect(response.data[0].fields[1].name).toBe('MyApp - b - BTM|a|b|c');
  });

  test('passes rollup=true through to the API', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(buildRequest([{ application: 'App', metricPath: 'X', rollup: true }]));

    expect(fetchParams(fetch).params.rollup).toBe('true');
  });

  test('expands multi-value variables into one request per concrete path', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource, templateSrv } = createDataSource(fetch);

    await dataSource.query(buildRequest([{ application: '$app', metricPath: 'Tiers|$tiers|Calls' }]));

    // The format callback handed to templateSrv.replace encodes multi-values
    // structurally so that expansion recovers them exactly...
    const formatArg = templateSrv.replace.mock.calls.find((call) => typeof call[2] === 'function')?.[2] as (
      value: string | string[]
    ) => string;
    expect(expandMetricPathVariants(formatArg(['a', 'b']))).toEqual(['a', 'b']);
    expect(formatArg(['a'])).toBe('a');
    expect(formatArg('single')).toBe('single');

    // ...and the encoded path expands into one request per tier.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchParams(fetch, 0).params['metric-path']).toBe('Tiers|tierA|Calls');
    expect(fetchParams(fetch, 1).params['metric-path']).toBe('Tiers|tierB|Calls');
    expect(fetchParams(fetch, 0).url).toBe('http://proxy/controller/rest/applications/MyApp/metric-data');
  });

  test('multi-value variable values with commas/braces/parens reach the API intact', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(buildRequest([{ application: 'App', metricPath: 'BTs|$nasty|Calls' }]));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchParams(fetch, 0).params['metric-path']).toBe('BTs|BT (checkout, v2)|Calls');
    expect(fetchParams(fetch, 1).params['metric-path']).toBe('BTs|Err{or}s|Calls');
  });

  test('expands multi-value application variables into one query per application', async () => {
    const fetch = jest.fn(() => of({ data: [series('X|Calls', [{ startTimeInMillis: 1, value: 1 }])] }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ application: '$apps', metricPath: 'X|Calls' }]));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchParams(fetch, 0).url).toBe('http://proxy/controller/rest/applications/App1/metric-data');
    expect(fetchParams(fetch, 1).url).toBe('http://proxy/controller/rest/applications/App2/metric-data');
    // The default series name disambiguates by prefixing the application.
    expect(response.data[0].fields[1].name).toBe('App1: X|Calls');
    expect(response.data[1].fields[1].name).toBe('App2: X|Calls');
    expect(response.data.map((frame: { refId?: string }) => frame.refId)).toEqual(['A', 'A']);
  });

  test('runs the full application × metric path product and {{application}} disambiguates aliases', async () => {
    const fetch = jest.fn((_options: FetchCall) => of({ data: [series('a|b', [{ startTimeInMillis: 1, value: 1 }])] }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(
      buildRequest([{ application: '$apps', metricPath: 'Tiers|$tiers|Calls', alias: '{{application}}/{{2}}' }])
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    const calls = fetch.mock.calls.map(([options]) => {
      return `${options.url.split('/applications/')[1].split('/')[0]} ${options.params['metric-path']}`;
    });
    expect(calls).toEqual([
      'App1 Tiers|tierA|Calls',
      'App1 Tiers|tierB|Calls',
      'App2 Tiers|tierA|Calls',
      'App2 Tiers|tierB|Calls',
    ]);
    expect(response.data[0].fields[1].name).toBe('App1/b');
    expect(response.data[3].fields[1].name).toBe('App2/b');
  });

  test('keeps surviving frames when one expanded path fails (per-path errors)', async () => {
    const fetch = jest.fn((options: FetchCall) =>
      options.params['metric-path'] === 'Tiers|tierB|Calls'
        ? throwError(() => ({ status: 404, data: 'no such metric' }))
        : of({ data: [series('Tiers|tierA|Calls', [{ startTimeInMillis: 1, value: 1 }])] })
    );
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ application: 'App', metricPath: 'Tiers|$tiers|Calls' }]));

    // The surviving sibling path still contributes its frame...
    expect(response.data).toHaveLength(1);
    expect(response.data[0].fields[1].name).toBe('Tiers|tierA|Calls');
    // ...while the failed path is reported with refId and the failing path.
    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0].refId).toBe('A');
    expect(response.errors?.[0].status).toBe(404);
    expect(response.errors?.[0].message).toContain('HTTP 404');
    expect(response.errors?.[0].message).toContain('Tiers|tierB|Calls');
  });

  test('isolates per-target failures into DataQueryResponse.errors', async () => {
    const fetch = jest.fn((options: FetchCall) =>
      options.params['metric-path'] === 'bad'
        ? throwError(() => ({ status: 500, data: 'controller says no' }))
        : of({ data: [series('good', [{ startTimeInMillis: 1, value: 1 }])] })
    );
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(
      buildRequest([
        { application: 'App', metricPath: 'good' },
        { application: 'App', metricPath: 'bad' },
      ])
    );

    expect(response.data).toHaveLength(1);
    expect(response.data[0].refId).toBe('A');
    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0].refId).toBe('B');
    expect(response.errors?.[0].status).toBe(500);
    expect(response.errors?.[0].message).toContain('HTTP 500');
    expect(response.errors?.[0].message).toContain('metric path "bad"');
  });

  test('skips hidden targets and targets that fail filterQuery', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(
      buildRequest([
        { application: 'App', metricPath: 'X', hide: true },
        { application: 'App' }, // metrics without a path
      ])
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(response.data).toEqual([]);
    expect(response.errors).toBeUndefined();
  });

  test('accepts legacy string ranges via dateMath parsing', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(
      buildRequest([{ application: 'App', metricPath: 'X' }], {
        from: '2020-01-01T00:00:00.000Z',
        to: '2020-01-01T01:00:00.000Z',
      })
    );

    expect(fetchParams(fetch).params['start-time']).toBe(1577836800000);
    expect(fetchParams(fetch).params['end-time']).toBe(1577840400000);
  });
});

describe('query: events', () => {
  const events = [
    {
      id: 11,
      type: 'APPLICATION_ERROR',
      eventTime: 123,
      severity: 'ERROR',
      summary: 'Something broke',
      deepLinkUrl: 'https://controller/#/event/11',
      affectedEntities: [{ entityType: 'APPLICATION', name: 'MyApp' }, { entityType: 'NODE' }],
    },
    {
      id: 12,
      subType: 'sub',
      eventTime: 456,
    },
  ];

  test('builds an annotation-shaped table frame', async () => {
    const fetch = jest.fn(() => of({ data: events }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ queryType: 'events', application: 'App' }]));

    const frame = response.data[0];
    expect(frame.fields.map((field: { name: string }) => field.name)).toEqual([
      'time',
      'title',
      'text',
      'tags',
      'id',
      'deepLinkUrl',
    ]);
    expect(frame.fields[0].values).toEqual([123, 456]);
    expect(frame.fields[1].values).toEqual(['APPLICATION_ERROR', 'sub']);
    expect(frame.fields[2].values).toEqual(['Something broke', '']);
    expect(frame.fields[3].values).toEqual(['ERROR,MyApp', '']);
    expect(frame.fields[4].values).toEqual(['11', '12']);
    expect(frame.fields[5].values).toEqual(['https://controller/#/event/11', '']);
    expect(frame.meta?.preferredVisualisationType).toBe('table');
  });

  test('tags survive Grafana default annotation processing (field named "tags", split on bare comma)', async () => {
    // Grafana's default annotation processor (standardAnnotationSupport.ts in
    // grafana/grafana core — not published to npm, hence simulated here) maps
    // the field NAMED 'tags' and splits STRING values on ',' WITHOUT trimming.
    const fetch = jest.fn(() => of({ data: events }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ queryType: 'events', application: 'App' }]));

    const tagsField = response.data[0].fields.find((field: { name: string }) => field.name === 'tags');
    const firstRow: unknown = tagsField?.values[0];
    // The processor's split guard: only strings are split, on bare ','.
    const processed = typeof firstRow === 'string' ? firstRow.split(',') : firstRow;
    expect(processed).toEqual(['ERROR', 'MyApp']); // AnnotationEvent.tags: string[] — no stray whitespace
  });

  test('expands multi-value application variables into one events frame per application', async () => {
    const fetch = jest.fn(() => of({ data: events }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ queryType: 'events', application: '$apps' }]));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchParams(fetch, 0).url).toBe('http://proxy/controller/rest/applications/App1/events');
    expect(fetchParams(fetch, 1).url).toBe('http://proxy/controller/rest/applications/App2/events');
    expect(response.data).toHaveLength(2);
    expect(response.data.map((frame: { refId?: string }) => frame.refId)).toEqual(['A', 'A']);
  });

  test('interpolates event type variables and forwards them as csv', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(
      buildRequest([
        { queryType: 'events', application: 'App', eventTypes: ['$types', 'DEADLOCK'], severities: ['ERROR'] },
      ])
    );

    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/App/events');
    expect(fetchParams(fetch).params['event-types']).toBe('CUSTOM,STALL,DEADLOCK');
    expect(fetchParams(fetch).params.severities).toBe('ERROR');
  });

  test('falls back to required default event-types and severities when none are picked', async () => {
    const fetch = jest.fn(() => of({ data: [] }));
    const { dataSource } = createDataSource(fetch);

    await dataSource.query(buildRequest([{ queryType: 'events', application: 'App' }]));

    expect(fetchParams(fetch).params['event-types']).toBe('APPLICATION_ERROR,APPLICATION_CRASH,STALL,DEADLOCK');
    expect(fetchParams(fetch).params.severities).toBe('INFO,WARN,ERROR');
  });
});

describe('query: healthRuleViolations', () => {
  test('builds an annotation-shaped frame with timeEnd only for resolved violations', async () => {
    const violations = [
      {
        id: 1,
        name: 'CPU high',
        startTimeInMillis: 100,
        endTimeInMillis: 200,
        incidentStatus: 'RESOLVED',
        severity: 'CRITICAL',
        description: 'CPU above 90%',
        deepLinkUrl: 'https://controller/#/incident/1',
      },
      {
        id: 2,
        name: 'Memory high',
        startTimeInMillis: 300,
        endTimeInMillis: -1,
        incidentStatus: 'OPEN',
        severity: 'WARNING',
        affectedEntityDefinition: { entityType: 'APPLICATION_COMPONENT', name: 'web-tier' },
      },
    ];
    const fetch = jest.fn(() => of({ data: violations }));
    const { dataSource } = createDataSource(fetch);

    const response = await dataSource.query(buildRequest([{ queryType: 'healthRuleViolations', application: 'App' }]));

    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/App/problems/healthrule-violations');
    const frame = response.data[0];
    expect(frame.fields.map((field: { name: string }) => field.name)).toEqual([
      'time',
      'timeEnd',
      'title',
      'text',
      'tags',
      'deepLinkUrl',
    ]);
    expect(frame.fields[0].values).toEqual([100, 300]);
    expect(frame.fields[1].values).toEqual([200, null]);
    expect(frame.fields[2].values).toEqual(['CPU high', 'Memory high']);
    expect(frame.fields[3].values).toEqual(['CPU above 90%', 'web-tier']);
    expect(frame.fields[4].values).toEqual(['CRITICAL,RESOLVED', 'WARNING,OPEN']);
    expect(frame.fields[5].values).toEqual(['https://controller/#/incident/1', '']);
    expect(frame.meta?.preferredVisualisationType).toBe('table');
  });
});

describe('metricFindQuery', () => {
  const createForVariables = () => {
    const fetch = jest.fn((options: FetchCall) => {
      if (options.url.endsWith('/controller/rest/applications')) {
        return of({
          data: [
            { id: 1, name: 'App1' },
            { id: 2, name: 'App2' },
          ],
        });
      }
      if (options.url.endsWith('/tiers')) {
        return of({ data: [{ id: 3, name: 'Tier1' }] });
      }
      if (options.url.endsWith('/nodes')) {
        return of({ data: [{ id: 4, name: 'Node1' }] });
      }
      if (options.url.endsWith('/business-transactions')) {
        return of({ data: [{ id: 5, name: 'Checkout' }] });
      }
      if (options.url.endsWith('/metrics')) {
        return of({
          data: [
            { name: 'Overall Application Performance', type: 'folder' },
            { name: 'Calls per Minute', type: 'leaf' },
          ],
        });
      }
      return of({ data: [] });
    });
    return createDataSource(fetch);
  };

  test('applications (raw string)', async () => {
    const { dataSource } = createForVariables();

    await expect(dataSource.metricFindQuery('applications')).resolves.toEqual([
      { text: 'App1', value: 'App1' },
      { text: 'App2', value: 'App2' },
    ]);
  });

  test('tiers(App) hits the tiers endpoint', async () => {
    const { dataSource, fetch } = createForVariables();

    await expect(dataSource.metricFindQuery('tiers(My App)')).resolves.toEqual([{ text: 'Tier1', value: 'Tier1' }]);
    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/My%20App/tiers');
  });

  test('nodes($app) interpolates the application variable', async () => {
    const { dataSource, fetch } = createForVariables();

    await expect(dataSource.metricFindQuery('nodes($app)')).resolves.toEqual([{ text: 'Node1', value: 'Node1' }]);
    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/MyApp/nodes');
  });

  test('businessTransactions(App) and bts(App) alias', async () => {
    const { dataSource } = createForVariables();

    await expect(dataSource.metricFindQuery('businessTransactions(App)')).resolves.toEqual([
      { text: 'Checkout', value: 'Checkout' },
    ]);
    await expect(dataSource.metricFindQuery('bts(App)')).resolves.toEqual([{ text: 'Checkout', value: 'Checkout' }]);
  });

  test('metrics(App, Parent|Path) returns folders and leaves', async () => {
    const { dataSource, fetch } = createForVariables();

    await expect(dataSource.metricFindQuery('metrics(App, Overall|Sub)')).resolves.toEqual([
      { text: 'Overall Application Performance', value: 'Overall Application Performance' },
      { text: 'Calls per Minute', value: 'Calls per Minute' },
    ]);
    expect(fetchParams(fetch).params['metric-path']).toBe('Overall|Sub');
  });

  test('supports the structured variable query object', async () => {
    const { dataSource, fetch } = createForVariables();
    const query: AppDynamicsVariableQuery = { queryType: 'tiers', application: '$app' };

    await expect(dataSource.metricFindQuery(query)).resolves.toEqual([{ text: 'Tier1', value: 'Tier1' }]);
    expect(fetchParams(fetch).url).toBe('http://proxy/controller/rest/applications/MyApp/tiers');
  });

  test('empty string yields no values; unrecognized strings throw a friendly error', async () => {
    const { dataSource } = createForVariables();

    await expect(dataSource.metricFindQuery('')).resolves.toEqual([]);
    await expect(dataSource.metricFindQuery('garbage')).rejects.toThrow('Unrecognized variable query');
  });
});

describe('testDatasource', () => {
  test('reports the number of visible applications on success', async () => {
    const fetch = jest.fn(() =>
      of({
        data: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
      })
    );
    const { dataSource } = createDataSource(fetch);

    await expect(dataSource.testDatasource()).resolves.toEqual({
      status: 'success',
      message: 'Successfully connected: 2 application(s) visible',
    });
  });

  test('hints at username@account credentials on 401/403', async () => {
    for (const status of [401, 403]) {
      const fetch = jest.fn(() => throwError(() => ({ status, data: 'denied' })));
      const { dataSource } = createDataSource(fetch);

      const result = await dataSource.testDatasource();

      expect(result.status).toBe('error');
      expect(result.message).toContain(`HTTP ${status}`);
      expect(result.message).toContain('username@account');
    }
  });

  test('propagates friendly messages for other failures without throwing', async () => {
    const fetch = jest.fn(() => throwError(() => ({ status: 500, data: 'controller down' })));
    const { dataSource } = createDataSource(fetch);

    await expect(dataSource.testDatasource()).resolves.toEqual({
      status: 'error',
      message: 'AppDynamics request failed (HTTP 500): controller down',
    });
  });
});

describe('filterQuery / getQueryDisplayText / getDefaultQuery', () => {
  const { dataSource } = createDataSource(jest.fn(() => of({ data: [] })));

  test('metrics queries need application and metric path', () => {
    expect(dataSource.filterQuery({ refId: 'A' })).toBe(false);
    expect(dataSource.filterQuery({ refId: 'A', application: 'App' })).toBe(false);
    expect(dataSource.filterQuery({ refId: 'A', metricPath: 'X' })).toBe(false);
    expect(dataSource.filterQuery({ refId: 'A', application: 'App', metricPath: 'X' })).toBe(true);
  });

  test('legacy queryText satisfies the metric path requirement', () => {
    expect(dataSource.filterQuery({ refId: 'A', application: 'App', queryText: 'Legacy' })).toBe(true);
  });

  test('events and health rule violations only need an application', () => {
    expect(dataSource.filterQuery({ refId: 'A', queryType: 'events' })).toBe(false);
    expect(dataSource.filterQuery({ refId: 'A', queryType: 'events', application: 'App' })).toBe(true);
    expect(dataSource.filterQuery({ refId: 'A', queryType: 'healthRuleViolations', application: 'App' })).toBe(true);
  });

  test('getQueryDisplayText renders "app: path" style summaries', () => {
    expect(dataSource.getQueryDisplayText({ refId: 'A', application: 'App', metricPath: 'X|Y' })).toBe('App: X|Y');
    expect(dataSource.getQueryDisplayText({ refId: 'A', queryType: 'events', application: 'App' })).toBe('App: events');
    expect(dataSource.getQueryDisplayText({ refId: 'A', queryType: 'healthRuleViolations', application: 'App' })).toBe(
      'App: health rule violations'
    );
  });

  test('getDefaultQuery returns the shared defaults and annotations support is enabled', () => {
    expect(dataSource.getDefaultQuery('panel-editor' as never)).toEqual({
      queryType: 'metrics',
      rollup: false,
      dataField: 'value',
    });
    expect(dataSource.annotations).toEqual({});
  });
});

describe('editor convenience methods', () => {
  test('getApplications and browseMetricPath delegate to the client', async () => {
    const fetch = jest.fn((options: FetchCall) =>
      options.url.endsWith('/metrics')
        ? of({ data: [{ name: 'Child', type: 'folder' }] })
        : of({ data: [{ id: 1, name: 'App1' }] })
    );
    const { dataSource } = createDataSource(fetch);

    await expect(dataSource.getApplications()).resolves.toEqual([{ id: 1, name: 'App1' }]);
    await expect(dataSource.browseMetricPath('App1', 'Parent')).resolves.toEqual([{ name: 'Child', type: 'folder' }]);
    expect(fetchParams(fetch, 1).params['metric-path']).toBe('Parent');
  });
});

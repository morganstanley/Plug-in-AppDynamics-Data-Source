// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { of, throwError } from 'rxjs';
import type { BackendSrv } from '@grafana/runtime';

import { AppDynamicsApiError, AppDynamicsClient } from '../api/client';
import { ALL_SEVERITIES, DEFAULT_EVENT_TYPES } from '../types';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  getTemplateSrv: jest.fn(),
}));

const createClient = (payload: unknown = []) => {
  const fetch = jest.fn(() => of({ data: payload }));
  const client = new AppDynamicsClient('http://proxy', { fetch } as unknown as BackendSrv);
  return { client, fetch };
};

const fetchOptions = (fetch: jest.Mock, call = 0) => fetch.mock.calls[call][0];

describe('AppDynamicsClient URL building', () => {
  test('getApplications hits the applications endpoint with output=json', async () => {
    const { client, fetch } = createClient([{ id: 1, name: 'App' }]);

    await expect(client.getApplications()).resolves.toEqual([{ id: 1, name: 'App' }]);

    expect(fetchOptions(fetch)).toEqual({
      url: 'http://proxy/controller/rest/applications',
      method: 'GET',
      params: { output: 'json' },
    });
  });

  test('encodes application names containing spaces and special characters', async () => {
    const { client, fetch } = createClient();

    await client.getTiers('My App/№1 & Co');

    expect(fetchOptions(fetch).url).toBe(
      `http://proxy/controller/rest/applications/${encodeURIComponent('My App/№1 & Co')}/tiers`
    );
    expect(fetchOptions(fetch).url).toContain('My%20App%2F');
  });

  test('getNodes and getBusinessTransactions hit their endpoints', async () => {
    const { client, fetch } = createClient();

    await client.getNodes('App');
    await client.getBusinessTransactions('App');

    expect(fetchOptions(fetch, 0).url).toBe('http://proxy/controller/rest/applications/App/nodes');
    expect(fetchOptions(fetch, 1).url).toBe('http://proxy/controller/rest/applications/App/business-transactions');
  });

  test('browseMetrics omits metric-path for the root listing', async () => {
    const { client, fetch } = createClient();

    await client.browseMetrics('App');
    await client.browseMetrics('App', '');

    expect(fetchOptions(fetch, 0).params).toEqual({ output: 'json' });
    expect(fetchOptions(fetch, 1).params).toEqual({ output: 'json' });
  });

  test('browseMetrics passes metric-path for child listings', async () => {
    const { client, fetch } = createClient();

    await client.browseMetrics('App', 'Overall Application Performance');

    expect(fetchOptions(fetch).params).toEqual({
      'metric-path': 'Overall Application Performance',
      output: 'json',
    });
  });
});

describe('AppDynamicsClient getMetricData', () => {
  test('sends BETWEEN_TIMES range and rollup=false', async () => {
    const { client, fetch } = createClient();

    await client.getMetricData('App', 'A|B|*', 1000, 2000, false);

    expect(fetchOptions(fetch)).toEqual({
      url: 'http://proxy/controller/rest/applications/App/metric-data',
      method: 'GET',
      params: {
        'metric-path': 'A|B|*',
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': 1000,
        'end-time': 2000,
        rollup: 'false',
        output: 'json',
      },
    });
  });

  test('sends rollup=true when requested', async () => {
    const { client, fetch } = createClient();

    await client.getMetricData('App', 'A|B', 1, 2, true);

    expect(fetchOptions(fetch).params.rollup).toBe('true');
  });
});

describe('AppDynamicsClient getEvents', () => {
  test('applies default event types and severities when caller passes none (API requires both)', async () => {
    const { client, fetch } = createClient();

    await client.getEvents('App', 1, 2, [], []);

    expect(fetchOptions(fetch).params).toEqual({
      'time-range-type': 'BETWEEN_TIMES',
      'start-time': 1,
      'end-time': 2,
      'event-types': DEFAULT_EVENT_TYPES.join(','),
      severities: ALL_SEVERITIES.join(','),
      output: 'json',
    });
  });

  test('joins caller-provided event types and severities', async () => {
    const { client, fetch } = createClient();

    await client.getEvents('App', 1, 2, ['CUSTOM', 'STALL'], ['ERROR']);

    expect(fetchOptions(fetch).params['event-types']).toBe('CUSTOM,STALL');
    expect(fetchOptions(fetch).params.severities).toBe('ERROR');
  });
});

describe('AppDynamicsClient getHealthRuleViolations', () => {
  test('hits the healthrule-violations endpoint with BETWEEN_TIMES', async () => {
    const { client, fetch } = createClient();

    await client.getHealthRuleViolations('App', 5, 6);

    expect(fetchOptions(fetch)).toEqual({
      url: 'http://proxy/controller/rest/applications/App/problems/healthrule-violations',
      method: 'GET',
      params: {
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': 5,
        'end-time': 6,
        output: 'json',
      },
    });
  });
});

describe('AppDynamicsClient payload tolerance', () => {
  test.each([
    ['object payload', { error: 'nope' }],
    ['string payload', '<html>login page</html>'],
    ['null payload', null],
    ['undefined payload', undefined],
  ])('returns [] for non-array payloads (%s)', async (_label, payload) => {
    const { client } = createClient(payload);

    await expect(client.getApplications()).resolves.toEqual([]);
    await expect(client.getMetricData('App', 'A', 1, 2, false)).resolves.toEqual([]);
    await expect(client.getEvents('App', 1, 2, [], [])).resolves.toEqual([]);
  });
});

describe('AppDynamicsClient error normalization', () => {
  const createFailingClient = (error: unknown) => {
    const fetch = jest.fn(() => throwError(() => error));
    return new AppDynamicsClient('http://proxy', { fetch } as unknown as BackendSrv);
  };

  test('includes HTTP status and controller text from a fetch error', async () => {
    const client = createFailingClient({
      status: 401,
      statusText: 'Unauthorized',
      data: 'Invalid credentials',
      config: { url: '' },
    });

    const error = await client.getApplications().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppDynamicsApiError);
    expect((error as AppDynamicsApiError).status).toBe(401);
    expect((error as AppDynamicsApiError).message).toBe('AppDynamics request failed (HTTP 401): Invalid credentials');
  });

  test('reads controller text from data.message objects', async () => {
    const client = createFailingClient({ status: 500, data: { message: 'Controller exploded' } });

    await expect(client.getApplications()).rejects.toThrow(
      'AppDynamics request failed (HTTP 500): Controller exploded'
    );
  });

  test('falls back to statusText when no controller text is present', async () => {
    const client = createFailingClient({ status: 503, statusText: 'Service Unavailable', data: undefined });

    await expect(client.getApplications()).rejects.toThrow(
      'AppDynamics request failed (HTTP 503): Service Unavailable'
    );
  });

  test('wraps non-fetch errors with a friendly prefix', async () => {
    const client = createFailingClient(new Error('socket hang up'));

    const error = await client.getApplications().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppDynamicsApiError);
    expect((error as AppDynamicsApiError).status).toBeUndefined();
    expect((error as AppDynamicsApiError).message).toBe('AppDynamics request failed: socket hang up');
  });
});

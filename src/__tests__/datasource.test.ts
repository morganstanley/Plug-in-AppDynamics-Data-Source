// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { DataSource } from '../utils/datasource';
import { DataSourceInstanceSettings } from '@grafana/data';
import { AppdynamicsOptions } from '../utils/types';

const createDataSource = (datasourceRequest: jest.Mock) => {
  const settings = {
    id: 1,
    uid: '2',
    type: '1',
    name: 'test',
    jsonData: {},
    url: 'http://example.com',
  } as DataSourceInstanceSettings<AppdynamicsOptions>;

  return new DataSource(settings, { datasourceRequest } as any);
};

test('doRequest uses backend service and returns response', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue('aaa');
  const datasource = createDataSource(datasourceRequest);

  await expect(datasource.doRequest('a', 'b', 'c', 1, 2)).resolves.toStrictEqual('aaa');
  expect(datasourceRequest).toHaveBeenCalledTimes(1);
  expect(datasourceRequest.mock.calls[0][0].url).toContain(
    '/controller/rest/applications/b/metric-data'
  );
});

test('getFilteredNames returns matches for substring', () => {
  const datasource = createDataSource(jest.fn());
  expect(datasource.getFilteredNames('a', [{ name: 'aaa' }, { name: 'bbb' }])).toStrictEqual([
    { name: 'aaa' },
  ]);
});

test('getFilteredNames handles pipeline query', () => {
  const datasource = createDataSource(jest.fn());
  expect(datasource.getFilteredNames('a|b', [{ name: 'aaa' }, { name: 'bbb' }])).toStrictEqual([
    { name: 'bbb' },
  ]);
});

test('testDatasource returns success on 200', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue({ status: 200 });
  const datasource = createDataSource(datasourceRequest);

  await expect(datasource.testDatasource()).resolves.toStrictEqual({
    status: 'success',
    message: 'Data source is working',
    title: 'Success',
  });
});

test('testDatasource returns failure on non-200', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue({ status: 500 });
  const datasource = createDataSource(datasourceRequest);

  await expect(datasource.testDatasource()).resolves.toStrictEqual({
    status: 'failure',
    message: 'Data source is not working due to: 500',
    title: 'Failure',
  });
});

test('convertMetricData returns metric values', () => {
  const datasource = createDataSource(jest.fn());
  expect(
    datasource.convertMetricData({
      data: [
        {
          metricValues: [
            {
              value: 1,
              startTimeInMillis: 2,
            },
            {
              value: 2,
              startTimeInMillis: 3,
            },
          ],
        },
      ],
    })
  ).toStrictEqual([
    [1, 2],
    [2, 3],
  ]);
});

test('convertMetricData supports string values', () => {
  const datasource = createDataSource(jest.fn());
  expect(
    datasource.convertMetricData({
      data: [
        {
          metricValues: [
            {
              value: '1',
              startTimeInMillis: 2,
            },
          ],
        },
      ],
    })
  ).toStrictEqual([['1', 2]]);
});

test('convertMetricData returns empty array for invalid payloads', () => {
  const datasource = createDataSource(jest.fn());
  expect(datasource.convertMetricData('bad')).toStrictEqual([]);
  expect(datasource.convertMetricData({})).toStrictEqual([]);
});

test('getApplicationNames returns filtered names on success', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue({
    status: 200,
    data: [{ name: 'AppA' }, { name: 'AppB' }],
  });
  const datasource = createDataSource(datasourceRequest);

  await expect(datasource.getApplicationNames()).resolves.toStrictEqual([
    { name: 'AppA' },
    { name: 'AppB' },
  ]);
});

test('getApplicationNames returns empty list on failure', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue({ status: 500 });
  const datasource = createDataSource(datasourceRequest);

  await expect(datasource.getApplicationNames()).resolves.toStrictEqual([]);
});

test('query builds data frames from metric response', async () => {
  const datasourceRequest = jest.fn().mockResolvedValue({
    data: [
      {
        metricValues: [
          {
            value: 10,
            startTimeInMillis: 20,
          },
        ],
      },
    ],
  });
  const datasource = createDataSource(datasourceRequest);

  const response = await datasource.query({
    range: {
      from: 'now-1h',
      to: 'now',
    },
    targets: [
      {
        host: '1',
        application: '1',
        queryText: 'metric',
      },
    ],
  } as any);

  const frame = response.data[0] as any;
  expect(frame.fields[0].name).toStrictEqual('Time');
  expect(frame.fields[1].name).toStrictEqual('metric');
  expect(frame.length).toStrictEqual(1);
});

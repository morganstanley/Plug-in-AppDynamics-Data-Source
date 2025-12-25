// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  DateTime,
  FieldType,
  MutableDataFrame,
  dateMath,
} from '@grafana/data';

import { getBackendSrv } from '@grafana/runtime';

import { AppdynamicsOptions, MyQuery } from './types';

type BackendSrv = ReturnType<typeof getBackendSrv>;

interface MetricValue {
  value: number | string;
  startTimeInMillis: number;
}

interface MetricDataResponse {
  data?: Array<{
    metricValues?: MetricValue[];
  }>;
}

interface ApplicationName {
  name: string;
}

export class DataSource extends DataSourceApi<MyQuery, AppdynamicsOptions> {
  private readonly backendSrv: BackendSrv;
  private readonly url: string;
  private readonly hosts?: string[];
  private readonly username: string;
  private readonly password: string;

  constructor(
    instanceSettings: DataSourceInstanceSettings<AppdynamicsOptions>,
    backendSrv: BackendSrv = getBackendSrv()
  ) {
    super(instanceSettings);
    this.backendSrv = backendSrv;
    this.username = instanceSettings.username as string;
    this.password = instanceSettings.password as string;
    this.url = instanceSettings.url ?? '';
    this.hosts = instanceSettings.jsonData.hosts;
  }

  async doRequest(
    _host: string,
    application: string,
    query: string,
    startTime: number,
    endTime: number
  ) {
    return this.backendSrv.datasourceRequest({
      url: `${this.url}/controller/rest/applications/${application}/metric-data`,
      method: 'GET',
      params: {
        'metric-path': query,
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': startTime,
        'end-time': endTime,
        rollup: 'false',
        output: 'json',
      },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getApplicationNames(_query?: DataQueryRequest<MyQuery>): Promise<ApplicationName[]> {
    const response = await this.backendSrv.datasourceRequest({
      url: `${this.url}/controller/rest/applications`,
      method: 'GET',
      params: { output: 'json' },
    });

    if (response.status !== 200) {
      return [];
    }

    return this.getFilteredNames('', response.data as ApplicationName[]);
  }

  getFilteredNames(query: string, arrayResponse: ApplicationName[]) {
    const normalizedQuery = query.includes('|') ? (query.split('|').pop() ?? '') : query;

    if (normalizedQuery.length === 0) {
      return arrayResponse;
    }

    return arrayResponse.filter((element) => {
      const elementName = element.name.toLowerCase();
      const queryText = normalizedQuery.toLowerCase();
      return queryText.includes(elementName) || elementName.includes(queryText);
    });
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const startTime = this.toEpochMillis(options.range.from);
    const endTime = this.toEpochMillis(options.range.to);

    const frames = await Promise.all(
      options.targets.map(async (target) => {
        const response = await this.doRequest(
          target.host as string,
          target.application as string,
          target.queryText as string,
          startTime,
          endTime
        );

        const frame = new MutableDataFrame({
          refId: target.refId,
          fields: [
            { name: 'Time', type: FieldType.time },
            { name: target.queryText as string, type: FieldType.number },
          ],
        });

        this.convertMetricData(response as MetricDataResponse).forEach((point) => {
          frame.appendRow([point[1], point[0]]);
        });

        return frame;
      })
    );

    return { data: frames };
  }

  async testDatasource() {
    const response = await this.backendSrv.datasourceRequest({
      url: `${this.url}/controller/rest/applications`,
      method: 'GET',
      params: { output: 'json' },
    });

    if (response.status === 200) {
      return { status: 'success', message: 'Data source is working', title: 'Success' };
    }

    return {
      status: 'failure',
      message: `Data source is not working due to: ${response.status}`,
      title: 'Failure',
    };
  }

  convertMetricData(metricElement?: MetricDataResponse | string) {
    if (!metricElement || typeof metricElement === 'string') {
      return [];
    }

    const metricValues = metricElement.data?.[0]?.metricValues ?? [];
    return metricValues.map((metricValue) => [metricValue.value, metricValue.startTimeInMillis]);
  }

  private toEpochMillis(value: DateTime | string) {
    const parsed = dateMath.parse(value);
    return Math.ceil(parsed?.valueOf() ?? 0);
  }
}

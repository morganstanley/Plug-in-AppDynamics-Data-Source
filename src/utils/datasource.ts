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
  FieldType,
  dateMath,
  MutableDataFrame,
  DataSourceInstanceSettings,
} from '@grafana/data';

import { getBackendSrv } from '@grafana/runtime';

import { MyQuery, AppdynamicsOptions } from './types';

export class DataSource extends DataSourceApi<MyQuery, AppdynamicsOptions> {

  username: string;
  password: string;
  url: string;
  hosts?: string[];

  constructor(instanceSettings: DataSourceInstanceSettings<AppdynamicsOptions>) {
    super(instanceSettings);
    this.username = instanceSettings.username as string;
    this.password = instanceSettings.password as string;
    this.url = instanceSettings.url as string;
    this.hosts = instanceSettings.jsonData.hosts;
  }

  async doRequest(host: string, application: string, query: string, startTime: number, endTime: number) {
    const result = await getBackendSrv().datasourceRequest({
      url: this.url + '/controller/rest/applications/' + application + '/metric-data',
      method: 'GET',
      params: {
        'metric-path': query,
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': startTime,
        'end-time': endTime,
        'rollup': 'false',
        'output': 'json'
      },
      headers: { 'Content-Type': 'application/json' }
    })

    console.log(this.url);
    return result;
  }

  async getApplicationNames(query: DataQueryRequest<MyQuery>) {
    console.log(query?.targets[0]);
    console.log(typeof (query));
    let response = await getBackendSrv().datasourceRequest({
      url: this.url + '/controller/rest/applications',
      method: 'GET',
      params: { output: 'json' }
    });
    if (response.status === 200) {
      console.log(this.getFilteredNames('', response.data));
      return this.getFilteredNames('', response.data);
    } else {
      console.log(response.status);
      return [];
    }
  }

  getFilteredNames(query: string, arrayResponse: any) {
    if (query.indexOf('|') > -1) {
      const queryPieces = query.split('|');
      query = queryPieces[queryPieces.length - 1];
    }

    if (query.length === 0) {
      return arrayResponse;

    } else {
      return arrayResponse.filter((element: any) => {
        return query.toLowerCase().indexOf(element.name.toLowerCase()) !== -1
          || element.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
      });
    }
  }

  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const startTime = (Math.ceil(dateMath.parse(options.range.from)?.valueOf() as number));
    const endTime = (Math.ceil(dateMath.parse(options.range.to)?.valueOf() as number));
    const promises = options.targets.map((query) =>
      this.doRequest(query.host as string, query.application as string, query.queryText as string, startTime, endTime).then((response) => {
        const frame = new MutableDataFrame({
          refId: query.refId,
          fields: [
            { name: "Time", type: FieldType.time },
            { name: query.queryText as string, type: FieldType.number },
          ],
        });
        console.log(response);
        this.convertMetricData(response).forEach((point: any) => {
          frame.appendRow([point[1], point[0]]);
        });

        return frame;
      })
    );

    return Promise.all(promises).then((data) => ({ data }));
  }

  async testDatasource() {
    let response = await getBackendSrv().datasourceRequest({
      url: this.url + '/controller/rest/applications',
      method: 'GET',
      params: { output: 'json' }
    });

    if (response.status === 200) {
      return { status: 'success', message: 'Data source is working', title: 'Success' };
    } else {
      return { status: 'failure', message: 'Data source is not working due to: ' + response.status, title: 'Failure' };
    }
  }

  convertMetricData(metricElement: any) {
    const responseArray: any[] = [];
    console.log(typeof (metricElement));
    console.log(metricElement);
    if (!(typeof (metricElement) == 'string')) {
      metricElement?.data[0].metricValues.forEach((metricValue: any) => {
        responseArray.push([metricValue.value, metricValue.startTimeInMillis]);
      });
    }

    return responseArray;
  }

}

// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License"). 
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. 
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { DataSource } from '../utils/datasource';
import {
    DataSourceInstanceSettings,
} from '@grafana/data';
import { AppdynamicsOptions } from '../utils/types';

export class MockBackendSrv {
    public datasourceRequest(input: any) {
        return 'aaa';
    }
}

jest.mock('@grafana/runtime', () => ({
    getBackendSrv: () => new MockBackendSrv(), // define mock backend
}));

let datasource = new DataSource({
    id: 1,
    uid: '2',
    type: '1',
    name: 'test',
    jsonData: {},
} as DataSourceInstanceSettings<AppdynamicsOptions>);

test('test do request', async () => {
    expect(await datasource.doRequest(
        'a', 'b', 'c', 1, 2,
    ))
        .toStrictEqual('aaa');
})

test('get correct filtered names', () => {
    expect(datasource.getFilteredNames('a', [{ name: 'aaa' }, { name: 'bbb' }])).toStrictEqual([{ name: 'aaa' }]);
})

test('get correct filtered names with pipeline', () => {
    expect(datasource.getFilteredNames('a|b', [{ name: 'aaa' }, { name: 'bbb' }])).toStrictEqual([{ name: 'bbb' }]);
})

test('get correct test datasource', async () => {
    expect(await datasource.testDatasource()).toStrictEqual({
        status: 'failure',
        message: "Data source is not working due to: undefined",
        title: 'Failure',
    });
})

test('get correct test datasource', async () => {
    expect(datasource.convertMetricData({
        data: [{
            metricValues: [
                {
                    value: 1,
                    startTimeInMillis: 2
                },
                {
                    value: 2,
                    startTimeInMillis: 2
                },
            ]
        }]
    })).toStrictEqual([[1, 2], [2, 2]]);
})

test('get correct test datasource with different type', async () => {
    expect(datasource.convertMetricData({
        data: [{
            metricValues: [
                {
                    value: '1',
                    startTimeInMillis: 2
                },
            ]
        }]
    })).toStrictEqual([['1', 2]]);
})

test('get correct application names', async () => {
    return expect(await datasource.getApplicationNames({
        targets: [
            {}
        ]
    } as any)).toStrictEqual([]);
})

test('get correct query', async () => {
    return expect((await datasource.query({
        range: {
            from: 0,
            to: 1,
        },
        targets: [
            {
                host: '1',
                application: '1',
                queryText: '1',
            }
        ],
    } as any)).data[0].fields[0].name).toStrictEqual("Time");
})



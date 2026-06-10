// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { migrateQuery } from '../migrations';
import { AppDynamicsQuery } from '../types';

test('moves legacy queryText into metricPath', () => {
  const legacy: AppDynamicsQuery = {
    refId: 'A',
    application: 'MyApp',
    queryText: 'Overall Application Performance|Average Response Time (ms)',
  };

  const migrated = migrateQuery(legacy);

  expect(migrated.metricPath).toBe('Overall Application Performance|Average Response Time (ms)');
  expect(migrated.application).toBe('MyApp');
});

test('fills defaults for queryType, rollup and dataField', () => {
  const migrated = migrateQuery({ refId: 'A' });

  expect(migrated).toEqual({ refId: 'A', queryType: 'metrics', rollup: false, dataField: 'value' });
});

test('does not overwrite an existing metricPath with queryText', () => {
  const migrated = migrateQuery({ refId: 'A', metricPath: 'New|Path', queryText: 'Old|Path' });

  expect(migrated.metricPath).toBe('New|Path');
});

test('removes legacy fields', () => {
  const migrated = migrateQuery({
    refId: 'A',
    queryText: 'Old|Path',
    host: 'controller-1',
    metricSegments: ['Old', 'Path'],
  });

  expect(migrated.queryText).toBeUndefined();
  expect(migrated.host).toBeUndefined();
  expect(migrated.metricSegments).toBeUndefined();
  expect('queryText' in migrated).toBe(false);
  expect('host' in migrated).toBe(false);
  expect('metricSegments' in migrated).toBe(false);
});

test('preserves explicitly chosen values over defaults', () => {
  const migrated = migrateQuery({
    refId: 'A',
    queryType: 'events',
    application: 'App',
    rollup: true,
    dataField: 'max',
    alias: '{{1}}',
    eventTypes: ['CUSTOM'],
    severities: ['ERROR'],
  });

  expect(migrated.queryType).toBe('events');
  expect(migrated.rollup).toBe(true);
  expect(migrated.dataField).toBe('max');
  expect(migrated.alias).toBe('{{1}}');
  expect(migrated.eventTypes).toEqual(['CUSTOM']);
  expect(migrated.severities).toEqual(['ERROR']);
});

test('is idempotent', () => {
  const once = migrateQuery({ refId: 'A', application: 'App', queryText: 'Path' });
  const twice = migrateQuery(once);

  expect(twice).toEqual(once);
});

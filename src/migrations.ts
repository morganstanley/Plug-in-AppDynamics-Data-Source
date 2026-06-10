// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { AppDynamicsQuery, DEFAULT_QUERY } from './types';

/**
 * Upgrades queries saved by previous plugin versions to the current model and
 * fills defaults. Legacy dashboards stored the metric path either in
 * `queryText` (free text) or as `metricSegments` (a pipe-path split into an
 * array), and had no `queryType`.
 */
export function migrateQuery(query: AppDynamicsQuery): AppDynamicsQuery {
  const migrated: AppDynamicsQuery = { ...DEFAULT_QUERY, ...query };

  /* eslint-disable @typescript-eslint/no-deprecated -- migrating and stripping the deprecated legacy fields is this module's purpose */
  if (!migrated.metricPath && query.queryText) {
    migrated.metricPath = query.queryText;
  }
  if (!migrated.metricPath && Array.isArray(query.metricSegments) && query.metricSegments.length > 0) {
    migrated.metricPath = query.metricSegments.join('|');
  }

  delete migrated.queryText;
  delete migrated.host;
  delete migrated.metricSegments;
  /* eslint-enable @typescript-eslint/no-deprecated */

  return migrated;
}

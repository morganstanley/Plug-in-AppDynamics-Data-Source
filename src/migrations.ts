// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { AppDynamicsQuery, DEFAULT_QUERY } from './types';

/**
 * Upgrades queries saved by previous plugin versions to the current model and
 * fills defaults. Legacy dashboards stored the metric path in `queryText` and
 * had no `queryType`.
 */
export function migrateQuery(query: AppDynamicsQuery): AppDynamicsQuery {
  const migrated: AppDynamicsQuery = { ...DEFAULT_QUERY, ...query };

  if (!migrated.metricPath && query.queryText) {
    migrated.metricPath = query.queryText;
  }

  delete migrated.queryText;
  delete migrated.host;
  delete migrated.metricSegments;

  return migrated;
}

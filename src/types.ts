// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { DataQuery, DataSourceJsonData } from '@grafana/schema';

export type AppDynamicsQueryType = 'metrics' | 'events' | 'healthRuleViolations';

export type MetricStatField = 'value' | 'min' | 'max' | 'sum' | 'count' | 'current';

export type EventSeverity = 'INFO' | 'WARN' | 'ERROR';

export interface AppDynamicsQuery extends DataQuery {
  queryType?: AppDynamicsQueryType;
  application?: string;
  /** Pipe-delimited metric path; supports `*` wildcards and template variables. */
  metricPath?: string;
  /** When false (default) the controller returns full-resolution data points. */
  rollup?: boolean;
  /** Which statistic of each metric value to chart. */
  dataField?: MetricStatField;
  /** Legend template: {{application}}, {{metricPath}}, {{metricName}}, {{N}} (Nth path segment). */
  alias?: string;
  /** Events query: AppDynamics event types (e.g. APPLICATION_ERROR). */
  eventTypes?: string[];
  /** Events query: severities filter. */
  severities?: EventSeverity[];

  /** @deprecated Legacy free-text metric path, migrated to {@link metricPath}. */
  queryText?: string;
  /** @deprecated Legacy field, no longer used. */
  host?: string;
  /** @deprecated Legacy field, no longer used. */
  metricSegments?: string[];
}

export const DEFAULT_QUERY: Partial<AppDynamicsQuery> = {
  queryType: 'metrics',
  rollup: false,
  dataField: 'value',
};

export interface AppDynamicsOptions extends DataSourceJsonData {}

export type VariableQueryType = 'applications' | 'tiers' | 'nodes' | 'businessTransactions' | 'metrics';

export interface AppDynamicsVariableQuery {
  queryType: VariableQueryType;
  /** Required for every query type except 'applications'. */
  application?: string;
  /** For 'metrics': lists the children of this path ('' lists the roots). */
  metricPath?: string;
}

/** Event types offered by default in the events query editor. */
export const KNOWN_EVENT_TYPES = [
  'APPLICATION_ERROR',
  'APPLICATION_CRASH',
  'APPLICATION_DEPLOYMENT',
  'AGENT_EVENT',
  'CUSTOM',
  'DEADLOCK',
  'DIAGNOSTIC_SESSION',
  'POLICY_OPEN_WARNING',
  'POLICY_OPEN_CRITICAL',
  'POLICY_CLOSE_WARNING',
  'POLICY_CLOSE_CRITICAL',
  'RESOURCE_POOL_LIMIT',
  'STALL',
] as const;

/** The events API requires event-types; used when the query does not select any. */
export const DEFAULT_EVENT_TYPES = ['APPLICATION_ERROR', 'APPLICATION_CRASH', 'STALL', 'DEADLOCK'];

export const ALL_SEVERITIES: EventSeverity[] = ['INFO', 'WARN', 'ERROR'];

// --- AppDynamics REST API DTOs ---

export interface AppDynamicsEntity {
  id: number;
  name: string;
}

export interface AppDynamicsNode extends AppDynamicsEntity {
  tierName?: string;
  machineName?: string;
}

export interface AppDynamicsBusinessTransaction extends AppDynamicsEntity {
  tierName?: string;
  entryPointType?: string;
}

export interface MetricTreeItem {
  name: string;
  type: 'folder' | 'leaf';
}

export interface MetricValue {
  startTimeInMillis: number;
  value: number;
  min?: number;
  max?: number;
  current?: number;
  sum?: number;
  count?: number;
  occurrences?: number;
  standardDeviation?: number;
  useRange?: boolean;
}

export interface MetricSeries {
  metricId?: number;
  metricName?: string;
  metricPath?: string;
  frequency?: string;
  metricValues?: MetricValue[];
}

export interface AppDynamicsEntityRef {
  entityType?: string;
  entityId?: number;
  name?: string;
}

export interface AppDynamicsEvent {
  id: number;
  type?: string;
  subType?: string;
  eventTime: number;
  severity?: EventSeverity;
  summary?: string;
  deepLinkUrl?: string;
  affectedEntities?: AppDynamicsEntityRef[];
  triggeredEntity?: AppDynamicsEntityRef;
}

export interface HealthRuleViolation {
  id: number;
  name?: string;
  startTimeInMillis: number;
  endTimeInMillis?: number;
  detectedTimeInMillis?: number;
  incidentStatus?: string;
  severity?: string;
  description?: string;
  deepLinkUrl?: string;
  affectedEntityDefinition?: AppDynamicsEntityRef;
  triggeredEntityDefinition?: AppDynamicsEntityRef;
}

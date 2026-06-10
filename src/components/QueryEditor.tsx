// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import defaults from 'lodash/defaults';
import React, { useEffect, useState } from 'react';

import { QueryEditorProps, SelectableValue } from '@grafana/data';
import {
  Alert,
  InlineField,
  InlineFieldRow,
  InlineSwitch,
  Input,
  MultiSelect,
  RadioButtonGroup,
  Select,
} from '@grafana/ui';

import type { DataSource } from '../datasource';
import {
  ALL_SEVERITIES,
  AppDynamicsOptions,
  AppDynamicsQuery,
  AppDynamicsQueryType,
  DEFAULT_QUERY,
  EventSeverity,
  KNOWN_EVENT_TYPES,
  MetricStatField,
} from '../types';
import { MetricPathBrowser } from './MetricPathBrowser';

type Props = QueryEditorProps<DataSource, AppDynamicsQuery, AppDynamicsOptions>;

const QUERY_TYPE_OPTIONS: Array<SelectableValue<AppDynamicsQueryType>> = [
  { label: 'Metrics', value: 'metrics' },
  { label: 'Events', value: 'events' },
  { label: 'Health rule violations', value: 'healthRuleViolations' },
];

const STAT_FIELDS: MetricStatField[] = ['value', 'min', 'max', 'sum', 'count', 'current'];
const STAT_OPTIONS: Array<SelectableValue<MetricStatField>> = STAT_FIELDS.map((field) => ({
  label: field,
  value: field,
}));

const EVENT_TYPE_OPTIONS: Array<SelectableValue<string>> = KNOWN_EVENT_TYPES.map((eventType) => ({
  label: eventType,
  value: eventType,
}));

const SEVERITY_OPTIONS: Array<SelectableValue<EventSeverity>> = ALL_SEVERITIES.map((severity) => ({
  label: severity,
  value: severity,
}));

export function QueryEditor(props: Props) {
  const { datasource, onChange, onRunQuery } = props;
  const query = defaults({}, props.query, DEFAULT_QUERY);
  const queryType = query.queryType ?? 'metrics';

  const [appOptions, setAppOptions] = useState<Array<SelectableValue<string>>>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | undefined>(undefined);

  // Load the application list once per mount (appsLoading starts out true).
  useEffect(() => {
    let cancelled = false;
    datasource
      .getApplications()
      .then((apps) => {
        if (!cancelled) {
          setAppOptions(apps.map((app) => ({ label: app.name, value: app.name })));
          setAppsError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAppOptions([]);
          setAppsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAppsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  const update = (patch: Partial<AppDynamicsQuery>, run = true) => {
    onChange({ ...query, ...patch });
    if (run) {
      onRunQuery();
    }
  };

  return (
    <>
      {appsError && (
        <Alert severity="error" title="Failed to load applications">
          {appsError}
        </Alert>
      )}
      <InlineFieldRow>
        <InlineField label="Query type">
          <RadioButtonGroup
            options={QUERY_TYPE_OPTIONS}
            value={queryType}
            onChange={(value) => update({ queryType: value })}
          />
        </InlineField>
      </InlineFieldRow>
      <InlineFieldRow>
        <InlineField label="Application" grow tooltip="AppDynamics application. Type to use a variable like $app.">
          <Select
            aria-label="Application"
            options={appOptions}
            value={query.application ? { label: query.application, value: query.application } : null}
            isLoading={appsLoading}
            allowCustomValue
            placeholder="Select application"
            onChange={(option) => update({ application: option?.value ?? '' })}
          />
        </InlineField>
      </InlineFieldRow>
      {queryType === 'metrics' && (
        <>
          <InlineFieldRow>
            <InlineField label="Metric path" grow tooltip="Pipe-delimited metric path. `*` matches a whole level.">
              <MetricPathBrowser
                application={query.application ?? ''}
                datasource={datasource}
                value={query.metricPath ?? ''}
                onChange={(path) => update({ metricPath: path })}
              />
            </InlineField>
          </InlineFieldRow>
          <InlineFieldRow>
            <InlineField
              label="Alias"
              grow
              tooltip="Legend template. Tokens: {{application}}, {{metricPath}}, {{metricName}}, {{N}} = Nth path segment."
            >
              <Input
                aria-label="Alias"
                value={query.alias ?? ''}
                placeholder="e.g. {{1}} – {{metricPath}}"
                onChange={(e) => update({ alias: e.currentTarget.value }, false)}
                onBlur={onRunQuery}
              />
            </InlineField>
            <InlineField
              label="Rollup"
              tooltip="On: the controller aggregates the time range into a single value per metric. Off: full-resolution data points."
            >
              <InlineSwitch
                aria-label="Rollup"
                value={query.rollup ?? false}
                onChange={(e) => update({ rollup: e.currentTarget.checked })}
              />
            </InlineField>
            <InlineField label="Stat" tooltip="Which statistic of each data point to chart.">
              <Select
                aria-label="Stat"
                width={16}
                options={STAT_OPTIONS}
                value={query.dataField ?? 'value'}
                onChange={(option) => update({ dataField: option.value })}
              />
            </InlineField>
          </InlineFieldRow>
        </>
      )}
      {queryType === 'events' && (
        <InlineFieldRow>
          <InlineField
            label="Event types"
            grow
            tooltip="AppDynamics event types. Leave empty for the defaults: APPLICATION_ERROR, APPLICATION_CRASH, STALL, DEADLOCK."
          >
            <MultiSelect
              aria-label="Event types"
              options={EVENT_TYPE_OPTIONS}
              value={(query.eventTypes ?? []).map((eventType) => ({ label: eventType, value: eventType }))}
              allowCustomValue
              placeholder="Server defaults"
              onChange={(selected) =>
                update({ eventTypes: selected.map((option) => option.value).filter((v): v is string => !!v) })
              }
            />
          </InlineField>
          <InlineField label="Severities" tooltip="Leave empty to include all severities (INFO, WARN, ERROR).">
            <MultiSelect
              aria-label="Severities"
              options={SEVERITY_OPTIONS}
              value={(query.severities ?? []).map((severity) => ({ label: severity, value: severity }))}
              placeholder="All severities"
              onChange={(selected) =>
                update({
                  severities: selected.map((option) => option.value).filter((v): v is EventSeverity => !!v),
                })
              }
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </>
  );
}

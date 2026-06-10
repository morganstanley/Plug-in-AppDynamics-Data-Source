// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import React, { useEffect, useMemo, useState } from 'react';

import { SelectableValue } from '@grafana/data';
import { InlineField, InlineFieldRow, Input, Select } from '@grafana/ui';

import { parseVariableQuery, type DataSource } from '../datasource';
import { AppDynamicsVariableQuery, VariableQueryType } from '../types';

export interface VariableQueryEditorProps {
  /** Older dashboards may have stored the variable query as a plain string. */
  query: AppDynamicsVariableQuery | string;
  onChange: (query: AppDynamicsVariableQuery, definition?: string) => void;
  datasource: DataSource;
}

const QUERY_TYPE_OPTIONS: Array<SelectableValue<VariableQueryType>> = [
  { label: 'Applications', value: 'applications' },
  { label: 'Tiers', value: 'tiers' },
  { label: 'Nodes', value: 'nodes' },
  { label: 'Business transactions', value: 'businessTransactions' },
  { label: 'Metric path children', value: 'metrics' },
];

function buildDefinition(query: AppDynamicsVariableQuery): string {
  if (query.queryType === 'applications') {
    return 'applications';
  }
  if (query.queryType === 'metrics') {
    return `metrics(${query.application ?? ''}, ${query.metricPath ?? ''})`;
  }
  return `${query.queryType}(${query.application ?? ''})`;
}

export function VariableQueryEditor({ query, onChange, datasource }: VariableQueryEditorProps) {
  const isLegacyString = typeof query === 'string';
  // Legacy raw strings (e.g. `tiers(MyApp)`) initialize the structured controls with their
  // parsed content, so the first edit preserves it. Unparseable strings fall back to the
  // default; the raw string stays visible read-only either way until an edit replaces it.
  const structured: AppDynamicsVariableQuery = useMemo(() => {
    if (typeof query !== 'string') {
      return query;
    }
    try {
      return parseVariableQuery(query) ?? { queryType: 'applications' };
    } catch {
      return { queryType: 'applications' };
    }
  }, [query]);

  const [appOptions, setAppOptions] = useState<Array<SelectableValue<string>>>([]);
  const [appsLoading, setAppsLoading] = useState(true);

  // Load the application list once per mount (appsLoading starts out true).
  useEffect(() => {
    let cancelled = false;
    datasource
      .getApplications()
      .then((apps) => {
        if (!cancelled) {
          setAppOptions(apps.map((app) => ({ label: app.name, value: app.name })));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppOptions([]);
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

  const emit = (patch: Partial<AppDynamicsVariableQuery>) => {
    const next: AppDynamicsVariableQuery = { ...structured, ...patch };
    if (next.queryType !== 'metrics') {
      delete next.metricPath;
    }
    onChange(next, buildDefinition(next));
  };

  return (
    <>
      {isLegacyString && (
        <InlineFieldRow>
          <InlineField
            label="Legacy query"
            grow
            disabled
            tooltip="Raw query string from an older dashboard. Editing the fields below replaces it with a structured query."
          >
            <Input aria-label="Legacy query" value={query} disabled />
          </InlineField>
        </InlineFieldRow>
      )}
      <InlineFieldRow>
        <InlineField label="Query type" tooltip="What the variable lists.">
          <Select
            aria-label="Query type"
            width={28}
            options={QUERY_TYPE_OPTIONS}
            value={structured.queryType}
            onChange={(option) => {
              if (option.value) {
                emit({ queryType: option.value });
              }
            }}
          />
        </InlineField>
        {structured.queryType !== 'applications' && (
          <InlineField
            label="Application"
            grow
            tooltip="AppDynamics application. Chained variables like $app work too."
          >
            <Select
              aria-label="Application"
              options={appOptions}
              value={structured.application ? { label: structured.application, value: structured.application } : null}
              isLoading={appsLoading}
              allowCustomValue
              placeholder="Select application"
              onChange={(option) => emit({ application: option?.value ?? '' })}
            />
          </InlineField>
        )}
      </InlineFieldRow>
      {structured.queryType === 'metrics' && (
        <InlineFieldRow>
          <InlineField
            label="Metric path"
            grow
            tooltip="Lists the children of this pipe-delimited path. Leave empty to list the root folders."
          >
            <Input
              aria-label="Metric path"
              value={structured.metricPath ?? ''}
              placeholder="e.g. Overall Application Performance"
              onChange={(e) => emit({ metricPath: e.currentTarget.value })}
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </>
  );
}

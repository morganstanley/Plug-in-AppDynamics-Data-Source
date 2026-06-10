// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import React from 'react';

import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Alert, DataSourceHttpSettings } from '@grafana/ui';

import { AppDynamicsOptions } from '../types';

export type Props = DataSourcePluginOptionsEditorProps<AppDynamicsOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  return (
    <>
      <Alert severity="info" title="Connecting to AppDynamics">
        Point the URL at your controller root (for SaaS: https://&lt;account&gt;.saas.appdynamics.com) — the plugin
        calls <code>/controller/rest/...</code> under it. With Basic auth, the user name must be in the{' '}
        <code>username@account</code> format. Alternatively, an API client access token sent via a custom{' '}
        <code>Authorization: Bearer ...</code> header also works.
      </Alert>
      <DataSourceHttpSettings
        defaultUrl="https://<account>.saas.appdynamics.com"
        dataSourceConfig={options}
        onChange={onOptionsChange}
      />
    </>
  );
}

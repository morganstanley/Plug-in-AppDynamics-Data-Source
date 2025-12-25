// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import React, { PureComponent } from 'react';
import { DataSourceHttpSettings } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { AppdynamicsOptions } from '../utils/types';

interface Props extends DataSourcePluginOptionsEditorProps<AppdynamicsOptions> {}

export class ConfigEditor extends PureComponent<Props> {
  render() {
    const { options, onOptionsChange } = this.props;

    return (
      <div className="gf-form-group">
        <DataSourceHttpSettings
          defaultUrl="http://localhost:8080"
          dataSourceConfig={options}
          onChange={onOptionsChange}
        />
      </div>
    );
  }
}

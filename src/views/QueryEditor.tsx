// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License"). 
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. 
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import defaults from 'lodash/defaults';

import React, { ChangeEvent, PureComponent } from 'react';
import { LegacyForms } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../utils/datasource';
import { defaultQuery, AppdynamicsOptions, MyQuery } from '../utils/types';

const { FormField } = LegacyForms;

type Props = QueryEditorProps<DataSource, MyQuery, AppdynamicsOptions>;

export class QueryEditor extends PureComponent<Props> {
  onQueryTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query } = this.props;
    onChange({ ...query, queryText: event.target.value });
  };

  onApplicationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query } = this.props;
    onChange({ ...query, application: event.target.value });
  };


  render() {
    const query = defaults(this.props.query, defaultQuery);
    const { queryText, application } = query;

    return (
      <div className="section gf-form-group">
        <div className="gf-form gf-form--grow">
          <FormField
            value={application || ''}
            onChange={this.onApplicationChange}
            labelWidth={5}
            inputWidth={80}
            label="Application"
            type="string"
          />
        </div>
        <div className="gf-form gf-form--grow">
        <FormField
            value={queryText || ''}
            onChange={this.onQueryTextChange}
            labelWidth={5}
            inputWidth={80}
            label="Query"
            type="string"
          />
        </div>
      </div>
    );
  }
}
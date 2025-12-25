// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './utils/datasource';
import { ConfigEditor } from './views/ConfigEditor';
import { QueryEditor } from './views/QueryEditor';
import { MyQuery, AppdynamicsOptions } from './utils/types';

export const plugin = new DataSourcePlugin<DataSource, MyQuery, AppdynamicsOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);

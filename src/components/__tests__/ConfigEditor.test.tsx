// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { render, screen } from '@testing-library/react';
import React from 'react';

import { ConfigEditor, Props } from '../ConfigEditor';

const options = {
  id: 1,
  uid: 'appd',
  orgId: 1,
  name: 'AppDynamics',
  type: 'appdynamics-datasource',
  typeName: 'AppDynamics',
  typeLogoUrl: '',
  access: 'proxy',
  url: '',
  user: '',
  database: '',
  basicAuth: true,
  basicAuthUser: '',
  isDefault: false,
  jsonData: {},
  secureJsonFields: {},
  readOnly: false,
  withCredentials: false,
} as unknown as Props['options'];

describe('ConfigEditor', () => {
  it('renders the HTTP settings with the AppDynamics hint', () => {
    render(<ConfigEditor options={options} onOptionsChange={jest.fn()} />);

    expect(screen.getByText('Connecting to AppDynamics')).toBeInTheDocument();
    expect(screen.getByText('username@account')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://<account>.saas.appdynamics.com')).toBeInTheDocument();
  });
});

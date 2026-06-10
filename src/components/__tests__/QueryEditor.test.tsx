// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { QueryEditor } from '../QueryEditor';
import { AppDynamicsQuery } from '../../types';

type Props = React.ComponentProps<typeof QueryEditor>;

// jsdom does not implement IntersectionObserver, which the @grafana/ui select menu uses.
beforeAll(() => {
  Object.defineProperty(global, 'IntersectionObserver', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
      takeRecords: jest.fn().mockReturnValue([]),
    })),
  });
});

// Minimal structural stand-in for the DataSource class so these tests do not depend on
// src/datasource.ts at runtime.
interface MockDatasource {
  getApplications: jest.Mock;
  browseMetricPath: jest.Mock;
}

const makeDatasource = (): MockDatasource => ({
  getApplications: jest.fn().mockResolvedValue([
    { id: 1, name: 'App One' },
    { id: 2, name: 'App Two' },
  ]),
  browseMetricPath: jest.fn().mockResolvedValue([]),
});

const renderEditor = (query: Partial<AppDynamicsQuery> = {}, datasource: MockDatasource = makeDatasource()) => {
  const onChange = jest.fn();
  const onRunQuery = jest.fn();
  const props = {
    datasource,
    query: { refId: 'A', ...query },
    onChange,
    onRunQuery,
  } as unknown as Props;
  const view = render(<QueryEditor {...props} />);
  return { ...view, onChange, onRunQuery, datasource };
};

const openSelect = (input: HTMLElement) => {
  fireEvent.keyDown(input, { key: 'ArrowDown' });
};

describe('QueryEditor', () => {
  it('renders the metrics editor by default', async () => {
    const { datasource } = renderEditor();

    expect(screen.getByText('Query type')).toBeInTheDocument();
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Metric path')).toBeInTheDocument();
    expect(screen.getByText('Alias')).toBeInTheDocument();
    expect(screen.getByText('Rollup')).toBeInTheDocument();
    expect(screen.getByText('Stat')).toBeInTheDocument();
    expect(screen.queryByText('Event types')).not.toBeInTheDocument();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalledTimes(1));
  });

  it('switches the sub-editor with the query type', async () => {
    const { onChange, onRunQuery, datasource } = renderEditor();

    fireEvent.click(screen.getByText('Events'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ queryType: 'events' }));
    expect(onRunQuery).toHaveBeenCalled();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('renders the events editor for events queries', async () => {
    const { datasource } = renderEditor({ queryType: 'events' });

    expect(screen.getByText('Event types')).toBeInTheDocument();
    expect(screen.getByText('Severities')).toBeInTheDocument();
    expect(screen.queryByText('Alias')).not.toBeInTheDocument();
    expect(screen.queryByText('Metric path')).not.toBeInTheDocument();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('renders only the application field for health rule violations', async () => {
    const { datasource } = renderEditor({ queryType: 'healthRuleViolations' });

    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.queryByText('Alias')).not.toBeInTheDocument();
    expect(screen.queryByText('Event types')).not.toBeInTheDocument();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('populates the application select from the datasource and emits the selection', async () => {
    const { onChange, onRunQuery } = renderEditor();

    openSelect(screen.getByLabelText('Application'));
    fireEvent.click(await screen.findByText('App One'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ application: 'App One' }));
    expect(onRunQuery).toHaveBeenCalled();
  });

  it('shows an alert when applications cannot be loaded', async () => {
    const datasource = makeDatasource();
    datasource.getApplications.mockRejectedValue(new Error('401 Unauthorized'));
    renderEditor({}, datasource);

    expect(await screen.findByText('Failed to load applications')).toBeInTheDocument();
    expect(screen.getByText('401 Unauthorized')).toBeInTheDocument();
  });

  it('updates the alias without running the query until blur', async () => {
    const { onChange, onRunQuery, datasource } = renderEditor({ application: 'App One' });

    const alias = screen.getByLabelText('Alias');
    fireEvent.change(alias, { target: { value: '{{1}}' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alias: '{{1}}' }));
    expect(onRunQuery).not.toHaveBeenCalled();

    fireEvent.blur(alias);
    expect(onRunQuery).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('toggles rollup and runs the query', async () => {
    const { onChange, onRunQuery, datasource } = renderEditor({ application: 'App One' });

    fireEvent.click(screen.getByLabelText('Rollup'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rollup: true }));
    expect(onRunQuery).toHaveBeenCalled();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('emits selected event types', async () => {
    const { onChange, onRunQuery, datasource } = renderEditor({ queryType: 'events', application: 'App One' });

    openSelect(screen.getByLabelText('Event types'));
    fireEvent.click(await screen.findByText('APPLICATION_ERROR'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ eventTypes: ['APPLICATION_ERROR'] }));
    expect(onRunQuery).toHaveBeenCalled();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });
});

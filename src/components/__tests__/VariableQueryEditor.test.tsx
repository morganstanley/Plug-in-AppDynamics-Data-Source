// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { VariableQueryEditor } from '../VariableQueryEditor';
import { AppDynamicsVariableQuery } from '../../types';

type Props = React.ComponentProps<typeof VariableQueryEditor>;

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

const makeDatasource = () => ({
  getApplications: jest.fn().mockResolvedValue([{ id: 1, name: 'My App' }]),
});

const renderEditor = (query: AppDynamicsVariableQuery | string, datasource = makeDatasource()) => {
  const onChange = jest.fn();
  const props = { query, onChange, datasource } as unknown as Props;
  const view = render(<VariableQueryEditor {...props} />);
  return { ...view, onChange, datasource };
};

const openSelect = (input: HTMLElement) => {
  fireEvent.keyDown(input, { key: 'ArrowDown' });
};

describe('VariableQueryEditor', () => {
  it('hides application and metric path for the applications query type', async () => {
    const { datasource } = renderEditor({ queryType: 'applications' });

    expect(screen.getByText('Query type')).toBeInTheDocument();
    expect(screen.queryByText('Application')).not.toBeInTheDocument();
    expect(screen.queryByText('Metric path')).not.toBeInTheDocument();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('shows the application select for tiers and emits query + definition', async () => {
    const { onChange } = renderEditor({ queryType: 'tiers' });

    expect(screen.getByText('Application')).toBeInTheDocument();

    openSelect(screen.getByLabelText('Application'));
    fireEvent.click(await screen.findByText('My App'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'tiers', application: 'My App' }),
      'tiers(My App)'
    );
  });

  it('emits a structured query and definition when the type changes', async () => {
    const { onChange, datasource } = renderEditor({ queryType: 'applications' });

    openSelect(screen.getByLabelText('Query type'));
    fireEvent.click(await screen.findByText('Nodes'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ queryType: 'nodes' }), 'nodes()');

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('shows the metric path input only for metrics queries and includes it in the definition', async () => {
    const { onChange, datasource } = renderEditor({ queryType: 'metrics', application: 'My App' });

    const pathInput = screen.getByLabelText('Metric path');
    fireEvent.change(pathInput, { target: { value: 'Overall Application Performance' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        queryType: 'metrics',
        application: 'My App',
        metricPath: 'Overall Application Performance',
      }),
      'metrics(My App, Overall Application Performance)'
    );

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('drops the metric path when switching away from metrics', async () => {
    const { onChange, datasource } = renderEditor({
      queryType: 'metrics',
      application: 'My App',
      metricPath: 'Errors',
    });

    openSelect(screen.getByLabelText('Query type'));
    fireEvent.click(await screen.findByText('Tiers'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'tiers', application: 'My App' }),
      'tiers(My App)'
    );
    const emitted = onChange.mock.calls[0][0];
    expect(emitted.metricPath).toBeUndefined();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('initializes the structured controls from a parseable legacy string and preserves its content on edit', async () => {
    const { onChange, datasource } = renderEditor('tiers(Legacy App)');

    const legacyInput = screen.getByLabelText('Legacy query');
    expect(legacyInput).toHaveValue('tiers(Legacy App)');
    expect(legacyInput).toBeDisabled();

    // The parsed legacy content shows up in the structured controls.
    expect(screen.getByText('Tiers')).toBeInTheDocument();
    expect(screen.getByText('Legacy App')).toBeInTheDocument();

    // The first edit emits a structured query that keeps the parsed application.
    openSelect(screen.getByLabelText('Query type'));
    fireEvent.click(await screen.findByText('Nodes'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'nodes', application: 'Legacy App' }),
      'nodes(Legacy App)'
    );

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('initializes application and metric path from a legacy metrics string', async () => {
    const { datasource } = renderEditor('metrics(My App, Overall Application Performance)');

    expect(screen.getByText('Metric path children')).toBeInTheDocument();
    expect(screen.getByText('My App')).toBeInTheDocument();
    expect(screen.getByLabelText('Metric path')).toHaveValue('Overall Application Performance');

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });

  it('falls back to the applications type for unparseable legacy strings', async () => {
    const { datasource } = renderEditor('not a known query');

    expect(screen.getByLabelText('Legacy query')).toHaveValue('not a known query');
    expect(screen.getByText('Applications')).toBeInTheDocument();
    expect(screen.queryByText('Metric path')).not.toBeInTheDocument();

    await waitFor(() => expect(datasource.getApplications).toHaveBeenCalled());
  });
});

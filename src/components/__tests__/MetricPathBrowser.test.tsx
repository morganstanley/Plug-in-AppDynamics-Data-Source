// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MetricPathBrowser } from '../MetricPathBrowser';
import { MetricTreeItem } from '../../types';

type Props = React.ComponentProps<typeof MetricPathBrowser>;

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

const TREE: Record<string, MetricTreeItem[]> = {
  '': [
    { name: 'Overall Application Performance', type: 'folder' },
    { name: 'Errors', type: 'folder' },
  ],
  'Overall Application Performance': [
    { name: 'Average Response Time (ms)', type: 'leaf' },
    { name: 'Calls per Minute', type: 'leaf' },
  ],
};

const makeDatasource = () => ({
  browseMetricPath: jest.fn(
    async (_app: string, parentPath?: string): Promise<MetricTreeItem[]> => TREE[parentPath ?? ''] ?? []
  ),
});

const renderBrowser = (value: string, application = 'MyApp', datasource = makeDatasource()) => {
  const onChange = jest.fn();
  const props = { application, value, onChange, datasource } as unknown as Props;
  const view = render(<MetricPathBrowser {...props} />);
  return { ...view, onChange, datasource, props };
};

const openSelect = (input: HTMLElement) => {
  fireEvent.keyDown(input, { key: 'ArrowDown' });
};

describe('MetricPathBrowser', () => {
  it('renders a disabled input when no application is selected', () => {
    renderBrowser('', '');
    expect(screen.getByPlaceholderText('Select application first')).toBeDisabled();
  });

  it('loads root options and shows them with a * wildcard option', async () => {
    const { datasource } = renderBrowser('');

    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledWith('MyApp', undefined));

    openSelect(screen.getByLabelText('Metric path segment 1'));
    expect(await screen.findByText('Overall Application Performance')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('cascades to the next level after a folder segment', async () => {
    const { datasource, onChange } = renderBrowser('Overall Application Performance');

    // Level 2 select appears once the root options reveal the segment is a folder.
    const level2 = await screen.findByLabelText('Metric path segment 2');
    await waitFor(() =>
      expect(datasource.browseMetricPath).toHaveBeenCalledWith('MyApp', 'Overall Application Performance')
    );

    openSelect(level2);
    fireEvent.click(await screen.findByText('Average Response Time (ms)'));
    expect(onChange).toHaveBeenCalledWith('Overall Application Performance|Average Response Time (ms)');
  });

  it('treats * like a folder and keeps offering deeper levels', async () => {
    renderBrowser('*');
    expect(await screen.findByLabelText('Metric path segment 2')).toBeInTheDocument();
  });

  it('truncates deeper segments when an earlier level changes', async () => {
    const { onChange } = renderBrowser('Overall Application Performance|Average Response Time (ms)');

    openSelect(await screen.findByLabelText('Metric path segment 1'));
    fireEvent.click(await screen.findByText('Errors'));
    expect(onChange).toHaveBeenCalledWith('Errors');
  });

  it('caches browse results per application and prefix', async () => {
    const datasource = makeDatasource();
    const { rerender, props } = renderBrowser('Overall Application Performance', 'MyApp', datasource);

    await screen.findByLabelText('Metric path segment 2');
    const callsAfterMount = datasource.browseMetricPath.mock.calls.length;

    rerender(<MetricPathBrowser {...props} value="Overall Application Performance|Average Response Time (ms)" />);
    await screen.findByLabelText('Metric path segment 1');
    // Both prefixes were already fetched; a leaf at the end does not open a new level.
    await waitFor(() => expect(datasource.browseMetricPath.mock.calls.length).toBe(callsAfterMount));
  });

  it('switches to raw mode and commits hand-written paths on blur', async () => {
    const { onChange, datasource } = renderBrowser('Overall Application Performance');

    fireEvent.click(screen.getByText('Edit raw'));
    const input = screen.getByLabelText('Metric path');
    expect(input).toHaveValue('Overall Application Performance');

    fireEvent.change(input, { target: { value: 'Errors|$tier|*' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('Errors|$tier|*');

    // Toggle back to builder mode.
    fireEvent.click(screen.getByText('Builder'));
    expect(await screen.findByLabelText('Metric path segment 1')).toBeInTheDocument();
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalled());
  });

  it('commits raw edits on Enter', async () => {
    const { onChange } = renderBrowser('');

    fireEvent.click(screen.getByText('Edit raw'));
    const input = screen.getByLabelText('Metric path');
    fireEvent.change(input, { target: { value: 'Errors|*' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Errors|*');
  });
});

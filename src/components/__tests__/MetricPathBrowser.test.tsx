// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** Datasource whose responses are resolved manually by each test. */
const makeManualDatasource = (impl: (app: string, parentPath?: string) => Promise<MetricTreeItem[]>) => ({
  browseMetricPath: jest.fn(impl),
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

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

  it('applies out-of-order responses to their own level only', async () => {
    const root = deferred<MetricTreeItem[]>();
    const child = deferred<MetricTreeItem[]>();
    const datasource = makeManualDatasource((_app, parentPath) => (parentPath === '*' ? child.promise : root.promise));
    // Both levels of `*` start loading immediately (wildcards behave like folders).
    renderBrowser('*', 'MyApp', datasource);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledWith('MyApp', '*'));

    // The deeper level resolves BEFORE its parent.
    await act(async () => child.resolve([{ name: 'Child Leaf', type: 'leaf' }]));
    await act(async () => root.resolve([{ name: 'Root Folder', type: 'folder' }]));

    openSelect(screen.getByLabelText('Metric path segment 1'));
    expect(await screen.findByText('Root Folder')).toBeInTheDocument();
    expect(screen.queryByText('Child Leaf')).not.toBeInTheDocument();

    openSelect(screen.getByLabelText('Metric path segment 2'));
    expect(await screen.findByText('Child Leaf')).toBeInTheDocument();
  });

  it('drops stale responses after an application switch and keeps the committed value usable', async () => {
    const appA = deferred<MetricTreeItem[]>();
    const appB = deferred<MetricTreeItem[]>();
    const datasource = makeManualDatasource((app) => (app === 'AppA' ? appA.promise : appB.promise));
    const { rerender, props } = renderBrowser('Branch', 'AppA', datasource);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledWith('AppA', undefined));

    rerender(<MetricPathBrowser {...props} application="AppB" />);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledWith('AppB', undefined));

    // The old application's slow response arrives after the switch — it must be ignored.
    await act(async () => appA.resolve([{ name: 'Stale Folder', type: 'folder' }]));

    openSelect(screen.getByLabelText('Metric path segment 1'));
    expect(screen.queryByText('Stale Folder')).not.toBeInTheDocument();
    // The committed path segment is still rendered and usable while options load.
    expect(screen.getByText('Branch')).toBeInTheDocument();

    await act(async () => appB.resolve([{ name: 'Fresh Folder', type: 'folder' }]));
    expect(await screen.findByText('Fresh Folder')).toBeInTheDocument();
  });

  it('does not update state when a response arrives after unmount', async () => {
    const root = deferred<MetricTreeItem[]>();
    const datasource = makeManualDatasource(() => root.promise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = renderBrowser('', 'MyApp', datasource);
      await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalled());

      unmount();
      root.resolve([{ name: 'Late Folder', type: 'folder' }]);
      await act(async () => {});

      // No "update not wrapped in act"/setState-after-unmount warnings.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps a failed level usable with * and retries when the menu is opened', async () => {
    const datasource = makeManualDatasource(async () => []);
    datasource.browseMetricPath
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValueOnce([{ name: 'Recovered Folder', type: 'folder' }]);
    renderBrowser('', 'MyApp', datasource);

    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledTimes(1));
    await act(async () => {}); // let the rejection settle into the failed state

    // The level still renders, shows the retry affordance, and is not stuck loading.
    const level1 = screen.getByLabelText('Metric path segment 1');
    expect(screen.getByText('Load failed — open to retry')).toBeInTheDocument();
    expect(screen.queryByText('Recovered Folder')).not.toBeInTheDocument();

    // Opening the menu forgets the failure and refetches; * stays available throughout.
    openSelect(level1);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Recovered Folder')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not poison the cache after repeated failures', async () => {
    const datasource = makeManualDatasource(async () => []);
    datasource.browseMetricPath
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValueOnce([{ name: 'Finally Loaded', type: 'folder' }]);
    renderBrowser('', 'MyApp', datasource);

    // Initial load fails; the failure is not auto-retried in a loop.
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(datasource.browseMetricPath).toHaveBeenCalledTimes(1);

    // First reopen → second attempt (fails again, still not cached as loaded).
    const level1 = screen.getByLabelText('Metric path segment 1');
    openSelect(level1);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledTimes(2));
    await act(async () => {});

    // Close and reopen → third attempt hits the datasource again and succeeds.
    fireEvent.keyDown(level1, { key: 'Escape' });
    openSelect(level1);
    await waitFor(() => expect(datasource.browseMetricPath).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Finally Loaded')).toBeInTheDocument();
  });
});

// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SelectableValue } from '@grafana/data';
import { Button, Input, Select } from '@grafana/ui';

import type { DataSource } from '../datasource';
import { MetricTreeItem } from '../types';

export interface MetricPathBrowserProps {
  application: string;
  /** Pipe-delimited metric path, e.g. `Overall Application Performance|Average Response Time (ms)`. */
  value: string;
  onChange: (path: string) => void;
  datasource: DataSource;
}

const WILDCARD = '*';

/**
 * Cascading metric-path picker. Renders one Select per path segment (options come from
 * `datasource.browseMetricPath`), plus a pending Select for the next level while the last
 * segment is a folder or `*`. A "Edit raw" toggle switches to a plain Input for hand-written
 * wildcards and template variables.
 */
export function MetricPathBrowser({ application, value, onChange, datasource }: MetricPathBrowserProps) {
  const [rawMode, setRawMode] = useState(false);
  const [rawDraft, setRawDraft] = useState(value);
  /**
   * Browse results keyed by application + path prefix. Doubles as the cache: entries are only
   * ever added for the current application and the whole map is reset when it changes.
   * `undefined` for a key means "not loaded yet" and renders as a loading state.
   */
  const [optionsByKey, setOptionsByKey] = useState<Record<string, MetricTreeItem[]>>({});

  // React's "adjust state during render" pattern (https://react.dev/learn/you-might-not-need-an-effect):
  // keep the raw editor in sync when the path changes from the outside...
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setRawDraft(value);
  }
  // ...and reset the options cache when the application changes (the path value is kept as-is).
  const [prevApplication, setPrevApplication] = useState(application);
  if (prevApplication !== application) {
    setPrevApplication(application);
    setOptionsByKey({});
  }

  /**
   * Generation counter for async browse completions: bumped when the application changes and
   * on unmount, so orphaned promises (slow responses for a previous application, or responses
   * arriving after unmount) never call setState. Responses for the *current* application are
   * additionally scoped by their key, so out-of-order arrivals cannot clobber other levels.
   */
  const epochRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());
  const lastLoadedApplicationRef = useRef(application);

  // On unmount, invalidate every outstanding completion.
  useEffect(() => {
    const epoch = epochRef;
    return () => {
      epoch.current += 1;
    };
  }, []);

  const segments = useMemo(() => (value ? value.split('|') : []), [value]);

  const keyFor = useCallback((prefix: string) => `${application}\u0000${prefix}`, [application]);

  // Whether a pending Select for the next (not yet chosen) level should show: always at the
  // root, after a `*` (wildcards may appear mid-path), or after a known folder segment.
  const nextLevelVisible = useMemo(() => {
    if (segments.length === 0) {
      return true;
    }
    const last = segments[segments.length - 1];
    if (last === WILDCARD) {
      return true;
    }
    const parentItems = optionsByKey[keyFor(segments.slice(0, -1).join('|'))];
    return parentItems?.some((item) => item.name === last && item.type === 'folder') ?? false;
  }, [segments, optionsByKey, keyFor]);

  // Load the options for every visible level that is not cached yet. setState happens only in
  // the async continuations, each guarded by the epoch and scoped to its own key.
  useEffect(() => {
    if (!application || rawMode) {
      return;
    }
    if (lastLoadedApplicationRef.current !== application) {
      lastLoadedApplicationRef.current = application;
      epochRef.current += 1;
      inFlightRef.current.clear();
    }
    const prefixes: string[] = [];
    for (let level = 0; level < segments.length; level++) {
      prefixes.push(segments.slice(0, level).join('|'));
    }
    if (nextLevelVisible) {
      prefixes.push(segments.join('|'));
    }
    for (const prefix of prefixes) {
      const key = keyFor(prefix);
      if (optionsByKey[key] !== undefined || inFlightRef.current.has(key)) {
        continue;
      }
      inFlightRef.current.add(key);
      const epoch = epochRef.current;
      datasource
        .browseMetricPath(application, prefix === '' ? undefined : prefix)
        .then((items) => {
          if (epochRef.current === epoch) {
            setOptionsByKey((prev) => ({ ...prev, [key]: items }));
          }
        })
        .catch(() => {
          // Browsing is best-effort; the `*` option and raw mode remain usable.
          if (epochRef.current === epoch) {
            setOptionsByKey((prev) => ({ ...prev, [key]: [] }));
          }
        })
        .finally(() => {
          inFlightRef.current.delete(key);
        });
    }
  }, [application, rawMode, segments, nextLevelVisible, optionsByKey, keyFor, datasource]);

  const handleLevelChange = (level: number, selected: string) => {
    // Choosing a value at level N truncates everything deeper than N.
    const next = [...segments.slice(0, level), selected].join('|');
    if (next !== value) {
      onChange(next);
    }
  };

  const commitRaw = () => {
    if (rawDraft !== value) {
      onChange(rawDraft);
    }
  };

  const toggleRawMode = () => {
    setRawDraft(value);
    setRawMode((prev) => !prev);
  };

  if (!application) {
    return <Input disabled placeholder="Select application first" aria-label="Metric path" />;
  }

  const levelSelects: React.ReactNode[] = [];
  for (let level = 0; level <= segments.length; level++) {
    const isPending = level === segments.length;
    if (isPending && !nextLevelVisible) {
      continue;
    }
    const prefix = segments.slice(0, level).join('|');
    const key = keyFor(prefix);
    const items = optionsByKey[key] ?? [];
    const current = isPending ? undefined : segments[level];
    const options: Array<SelectableValue<string>> = [
      { label: WILDCARD, value: WILDCARD, description: 'Wildcard — matches everything at this level' },
      ...items.map((item) => ({
        label: item.name,
        value: item.name,
        icon: item.type === 'folder' ? 'folder' : undefined,
      })),
    ];
    levelSelects.push(
      <Select
        key={`${level}-${prefix}`}
        aria-label={`Metric path segment ${level + 1}`}
        width="auto"
        options={options}
        value={current ? { label: current, value: current } : null}
        isLoading={optionsByKey[key] === undefined}
        placeholder="Select…"
        onChange={(option) => {
          if (option.value != null) {
            handleLevelChange(level, option.value);
          }
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', flexGrow: 1 }}>
      {rawMode ? (
        <div style={{ flexGrow: 1, minWidth: '240px' }}>
          <Input
            aria-label="Metric path"
            value={rawDraft}
            placeholder="Application Infrastructure Performance|*|JVM|Memory|Heap|Used %"
            onChange={(e) => setRawDraft(e.currentTarget.value)}
            onBlur={commitRaw}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitRaw();
              }
            }}
          />
        </div>
      ) : (
        levelSelects
      )}
      <Button
        size="sm"
        variant="secondary"
        type="button"
        onClick={toggleRawMode}
        tooltip={rawMode ? 'Switch back to the segment browser' : 'Edit the path as text (wildcards, variables)'}
      >
        {rawMode ? 'Builder' : 'Edit raw'}
      </Button>
    </div>
  );
}

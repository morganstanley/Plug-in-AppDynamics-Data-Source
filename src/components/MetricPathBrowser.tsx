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
  const [optionsByKey, setOptionsByKey] = useState<Record<string, MetricTreeItem[]>>({});
  const [loadingByKey, setLoadingByKey] = useState<Record<string, boolean>>({});
  /** Cache of browse results, keyed by application + path prefix. */
  const cacheRef = useRef(new Map<string, MetricTreeItem[]>());
  const inFlightRef = useRef(new Set<string>());
  const prevApplicationRef = useRef(application);

  const segments = useMemo(() => (value ? value.split('|') : []), [value]);

  const keyFor = useCallback((prefix: string) => `${application}\u0000${prefix}`, [application]);

  // Keep the raw editor in sync when the path changes from the outside.
  useEffect(() => {
    setRawDraft(value);
  }, [value]);

  // When the application changes, reset the options cache; the path value is kept as-is.
  useEffect(() => {
    if (prevApplicationRef.current !== application) {
      prevApplicationRef.current = application;
      cacheRef.current.clear();
      inFlightRef.current.clear();
      setOptionsByKey({});
      setLoadingByKey({});
    }
  }, [application]);

  const loadPrefix = useCallback(
    (prefix: string) => {
      const key = keyFor(prefix);
      const cached = cacheRef.current.get(key);
      if (cached) {
        setOptionsByKey((prev) => (prev[key] ? prev : { ...prev, [key]: cached }));
        return;
      }
      if (inFlightRef.current.has(key)) {
        return;
      }
      inFlightRef.current.add(key);
      setLoadingByKey((prev) => ({ ...prev, [key]: true }));
      datasource
        .browseMetricPath(application, prefix === '' ? undefined : prefix)
        .then((items) => {
          cacheRef.current.set(key, items);
          setOptionsByKey((prev) => ({ ...prev, [key]: items }));
        })
        .catch(() => {
          // Browsing is best-effort; the `*` option and raw mode remain usable.
          setOptionsByKey((prev) => ({ ...prev, [key]: [] }));
        })
        .finally(() => {
          inFlightRef.current.delete(key);
          setLoadingByKey((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        });
    },
    [application, datasource, keyFor]
  );

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

  // Load the options for every visible level (cached per application + prefix).
  useEffect(() => {
    if (!application || rawMode) {
      return;
    }
    for (let level = 0; level < segments.length; level++) {
      loadPrefix(segments.slice(0, level).join('|'));
    }
    if (nextLevelVisible) {
      loadPrefix(segments.join('|'));
    }
  }, [application, rawMode, segments, nextLevelVisible, loadPrefix]);

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
        isLoading={Boolean(loadingByKey[key])}
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

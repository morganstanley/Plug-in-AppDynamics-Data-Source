# Changelog

## 2.0.0 (Unreleased)

Full refactor and feature release.

### Features

- Metric path browser: cascading hierarchy selectors backed by the controller `/metrics` API,
  with a raw-edit mode for `*` wildcards and template variables.
- Application dropdown (async-loaded, custom values and variables supported).
- New query types: **Events** and **Health rule violations**, usable as tables and as Grafana
  annotations (`annotations` support enabled).
- Template variables: `applications`, `tiers(App)`, `nodes(App)`, `businessTransactions(App)`,
  `metrics(App, Parent|Path)` plus a structured variable query editor. Multi-value variables
  expand to one request per value.
- Legend alias templates: `{{application}}`, `{{metricPath}}`, `{{metricName}}`, `{{N}}`.
- Rollup toggle and stat selection (`value`/`min`/`max`/`sum`/`count`/`current`).
- Friendlier connection testing with auth hints.

### Fixes

- Wildcard metric paths now return **all** matching series (previously only the first was
  charted).
- Per-target and per-request error isolation: one failing request no longer hides data from
  the others.
- Added the missing plugin logo.

### Internal

- Layered architecture: typed REST client (`src/api/client.ts`) + datasource + function-component
  editors; deprecated `datasourceRequest`/`LegacyForms`/`MutableDataFrame` removed.
- Saved queries from 1.x (`queryText`, `metricSegments`) are migrated automatically.
- Toolchain modernized: Grafana packages 12.4, TypeScript 5.9, Jest 30, Testing Library 16,
  Prettier 3, ESLint 9 with current plugin majors.

## 1.0.0

Initial release.

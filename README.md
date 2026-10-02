# i18n-hunter

> AST-based hardcoded-string detection and transactional source transformation for Vue and React.

[![npm version](https://img.shields.io/npm/v/i18n-hunter)](https://www.npmjs.com/package/i18n-hunter)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](https://nodejs.org)

## Current release

`0.2.x` is a safety-focused pre-1.0 release. Reports use schema version 2 and legacy `0.1.x` reports must be regenerated before they can be applied.

The tool deliberately fails closed when it cannot prove that a source path, key, report, transformation, backup, or rollback is safe.

## Features

- Vue SFC and React/JSX AST extraction with exact UTF-16 source ranges
- Existing i18n calls and technical strings are excluded
- Unicode-safe, collision-resistant keys; opaque by default
- Canonical JSON reports; Markdown is derived from the same findings
- Source values are redacted by default
- Framework-aware `useI18n` / `useTranslation` injection for supported components
- Pre-apply source hash and slice verification
- Generated React/Vue source is reparsed or compiled before writing
- Recoverable, locked multi-file transactions with immutable backups
- Transaction-chain rollback and fail-closed cleanup
- Strict Node.js 20.19+ package with optional Vue compiler peers

## Installation

```bash
npm install --save-dev i18n-hunter
```

React parsing works without additional packages. Vue scanning requires the optional compiler peers:

```bash
npm install --save-dev @vue/compiler-sfc @vue/compiler-dom
```

The target project must already use `vue-i18n` or `react-i18next` if the generated code should run. `i18n-hunter` transforms source; it does not invent or update locale catalogs.

## Workflow

```bash
# 1. Scan src (default). Reports redact extracted values by default.
npx i18n-hunter scan

# Include source values when local review requires them.
npx i18n-hunter scan --include-values

# Opt in to readable, value-derived key segments as well.
npx i18n-hunter scan --include-values --readable-keys

# 2. Edit only suggestedKey values in the v2 JSON report.
# 3. Preview the exact transformation.
npx i18n-hunter apply --report ./i18n-reports/<report>.json --dry-run

# 4. Commit the reviewed transformation.
npx i18n-hunter apply --report ./i18n-reports/<report>.json

# 5. Restore the full active transaction chain if needed.
npx i18n-hunter rollback

# 6. Remove rolled-back managed transaction state.
npx i18n-hunter clean --yes
```

## Commands

### `scan`

```bash
i18n-hunter scan [options]
```

Key options:

| Option                              | Description                         | Default              |
| ----------------------------------- | ----------------------------------- | -------------------- |
| `--base <dir>`                      | Project root                        | Current directory    |
| `--path <path>`                     | File/directory to scan; repeatable  | `src`                |
| `--paths <a,b>`                     | Comma-separated compatibility alias | —                    |
| `--output <dir>`                    | Report directory                    | `i18n-reports`       |
| `--filename <name>`                 | Report basename                     | Timestamp-based name |
| `--format <json\|md\|json,md>`      | Report formats                      | `json,md`            |
| `--include-values`                  | Include source text in reports      | Redacted             |
| `--redact-values`                   | Explicitly select the safe default  | Redacted             |
| `--readable-keys`                   | Opt in to value-derived key names   | Opaque keys          |
| `--fail-on <error\|warning\|never>` | Partial-scan exit policy            | `error`              |
| `--max-file-size <bytes>`           | Per-file limit                      | 2 MB                 |
| `--max-files <count>`               | File-count limit                    | 10,000               |
| `--max-total-bytes <bytes>`         | Total source limit                  | 100 MB               |
| `--max-findings <count>`            | Finding limit                       | 10,000               |
| `--max-depth <count>`               | Discovery depth limit               | 50                   |

Tests, dependency output, generated output, reports, and transaction state are excluded by default. Symlinks are rejected.

### `apply`

```bash
i18n-hunter apply --report <report.json> [--base <dir>] [--state-dir <dir>] [--dry-run]
```

Apply performs all validation and compilation before creating a transaction. Backups are stored under `.i18n-hunter/` by default; no adjacent `.bak` files are created.

If the source changed after scanning, apply rejects the report. If a later file write fails, files already written are restored automatically.

### `sync`

```bash
i18n-hunter sync --report <report.json> [--output <report.md>]
```

Markdown is deterministically derived from the canonical `findings` array. Summary and category data are never accepted as a second source of truth.

### `rollback`

```bash
i18n-hunter rollback [--base <dir>] [--state-dir <dir>]
```

Rollback validates the full chain, backup hashes, project identity, and current source hashes before restoring any file. It refuses to overwrite edits made after apply.

### `clean`

```bash
i18n-hunter clean --yes [--base <dir>] [--state-dir <dir>]
```

Clean removes only owned, rolled-back transaction records, plus any manifest-less transaction residue left by an interrupted commit. Transactions that are applied, rolling back, or failed require a manual `rollback` first; there is intentionally no force-delete mode.

The state directory is never treated as source: `scan` excludes it and `apply` rejects any report that targets a path inside it, whatever the directory is named.

## Supported transformations

### Vue

- Static and bound user-facing attributes
- `v-text` literal expressions
- Template text nodes
- String and interpolated template literals in `<script setup>`

### React

- JSX text and user-facing string attributes
- String literals in JSX expression containers
- String and interpolated template literals in function components
- Multiple function components in one file
- `use client` directives are preserved

Class components, plain utility modules, React render functions outside a component scope, and Vue Options API script strings are reported as unsupported rather than transformed with an unsafe hook. Resolve those findings manually and regenerate the report.

## Privacy

Reports contain source paths, ranges, structural hashes, categories, and suggested keys. Extracted values, value digests, and readable value-derived key segments are omitted by default. `--readable-keys` opts in to human-readable key segments, and `--include-values` opts in to source text and its digest. Use either only when required and treat those reports as sensitive source code.

Backups contain complete source files. Keep the state directory on encrypted local storage and do not commit it. The tool writes a project-ownership marker and refuses to claim or clean a non-empty unowned directory.

## Exit codes

|  Code | Meaning                                                                        |
| ----: | ------------------------------------------------------------------------------ |
|   `0` | Completed according to the selected failure policy                             |
|   `1` | Invalid input, unsafe operation, parse/compile failure, or transaction failure |
|   `2` | Scan completed with error diagnostics or hit a failure threshold               |
| `130` | Interrupted by the host environment                                            |

## Library API

```ts
import {
  scanForHardcodedStrings,
  applyReport,
  rollbackTransactions,
  cleanTransactions,
  parseExtractionReport,
} from 'i18n-hunter'

const report = await scanForHardcodedStrings({}, process.cwd())
console.log(report.summary)
```

The public scanner is asynchronous because Vue compiler peers are loaded only when needed.

## Security and architecture

- [Architecture](docs/architecture.md)
- [Report schema](docs/report-schema.md)
- [Security model](docs/security-model.md)
- [Roadmap](docs/roadmap.md)
- [TDD evidence](docs/tdd-evidence.md)
- [Changelog](CHANGELOG.md)

## Development

```bash
npm ci
npm run verify
```

`verify` runs formatting, lint, type checking, coverage, real CLI smoke tests, a clean packed-package install without Vue peers, Vue-peer verification, and dependency auditing.

## License

MIT

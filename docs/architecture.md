# Architecture

## Design goals

`i18n-hunter` is a local source-analysis tool. Its primary invariants are:

1. Never mutate before every finding and generated file has been validated.
2. Never search source by line or string when an exact range exists.
3. Never trust a report, manifest, path, symlink, or key without validation.
4. Never silently report an incomplete scan as clean.
5. Keep framework behavior behind explicit parsing and transform modules.

## Pipeline

```text
CLI
 ├─ scan
 │  ├─ discovery + limits
 │  ├─ Vue SFC/template AST ─┐
 │  ├─ Babel JavaScript AST ─┼─ canonical findings
 │  ├─ key generation        │
 │  └─ report formatter      │
 ├─ sync ── validated canonical report ── deterministic Markdown
 ├─ apply
 │  ├─ report/path/key/hash validation
 │  ├─ source-range transforms
 │  ├─ framework injection
 │  ├─ generated-source parse/compile
 │  └─ locked recoverable transaction
 ├─ rollback ── chain/hash verification ── atomic restore
 └─ clean ── managed-state deletion only
```

## Module boundaries

| Module                    | Responsibility                                         |
| ------------------------- | ------------------------------------------------------ |
| `cli-args.ts`             | Strict syntax-only argument parsing                    |
| `cli-runner.ts`           | I/O orchestration and exit codes                       |
| `discovery.ts`            | Bounded, symlink-denied source discovery               |
| `vue-parser.ts`           | Lazy Vue compiler loading and Vue AST findings         |
| `javascript-extractor.ts` | Shared Babel parsing and JS/TS/JSX findings            |
| `key-generator.ts`        | Deterministic Unicode-aware key suggestions            |
| `report-schema.ts`        | Runtime-valid canonical v2 report                      |
| `report-verification.ts`  | Fresh-AST structural metadata verification             |
| `text-edit.ts`            | Range/hash/key validation and grouped edits            |
| `inject-react.ts`         | React component hooks and import placement             |
| `inject-vue.ts`           | Vue script-setup bindings and imports                  |
| `transform.ts`            | Pure source transformation and output validation       |
| `transaction-store.ts`    | Managed state layout, lock, and manifests              |
| `applier.ts`              | Preflight, commit, rollback, and cleanup orchestration |

## Canonical report model

Only `findings` is canonical. Category counts and Markdown sections are derived. Line and column values are display metadata; `range`, `fileSha256`, `sliceSha256`, and the fresh AST reparse are the apply-time authority. Redacted reports use opaque random key segments and omit value digests unless readable keys or values were explicitly requested.

## Transformation model

Transforms are pure until all preflight work succeeds. Every edit carries a range into the **original** source and is applied strictly right-to-left, so insertions (imports, hook declarations, block conversion) can never invalidate the offsets of edits still to be applied. Grouping is metadata only, not an ordering mechanism.

Every transformed result is reparsed with Babel or compiled through Vue SFC tooling before a transaction can commit.

## Transaction model

```text
<state-dir>/
  .i18n-hunter-state.json
  lock
  latest.json
  transactions/
    <transaction-id>/
      manifest.json
      backups/
        <project-relative-source-path>
```

A transaction records project and report fingerprints, parent transaction, relative paths, file modes, and before/after hashes. The ownership marker prevents a caller-supplied state path from claiming unrelated project data. Multi-file writes are recoverable but not claimed to be one operating-system transaction.

## Compatibility policy

This is pre-1.0 software. Security and data-integrity fixes may change the report schema and async public API. Legacy v0.1 reports are rejected rather than migrated into an unsafe apply path.

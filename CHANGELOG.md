# Changelog

## 0.2.0 - Unreleased

### Security

- Enforced runtime report and manifest validation.
- Rejected traversal, symlinks, stale source hashes, invalid keys, and overlapping edits.
- Added locked, hash-verified, recoverable transaction storage.
- Added generated React/Vue parse and compile gates.
- Added fresh-AST verification of report structure, redacted reports without value digests, opaque default keys, and strict diagnostic path handling.
- Added project-owned, symlink-denied state directories, stale-lock recovery, parent-backup validation, idempotent rollback progress, and non-forced cleanup.
- Hardened npm publication against fork-controlled and stale `workflow_run` events.

### Correctness

- Replaced the custom glob implementation and fixed default discovery.
- Rewrote Vue scripts and React extraction around exact AST ranges.
- Skipped existing i18n calls and technical values.
- Added component-aware React and Vue script-setup injection.
- Made report findings canonical and fixed Markdown synchronization.
- Corrected parenthesized concise arrow transforms, aliased i18n hook imports, technical template-literal filtering, and technical/dynamic Vue bound attributes.
- Fixed edit application to apply every planned edit right-to-left against the original source. Sibling component edits previously corrupted each other's offsets.
- Added independent binding injection for nested React component scopes.
- Preserved CRLF line endings in injected code.
- `clean` now removes a manifest-less transaction residue instead of wedging every state command.

### Operations

- Made Vue compiler peers genuinely optional and lazy.
- Added strict CLI parsing, command-specific help, and documented exit codes.
- Added real filesystem, CLI subprocess, and packed-package smoke tests.
- Added lint, formatting, type, coverage, package, and audit release gates.

### Breaking

- Reports now use schema version 2 and `findings`.
- `scanForHardcodedStrings()`, `parseVueComponent()`, and `extractTemplateStrings()` are asynchronous.
- Suggested keys are opaque by default; use `readableKeys` / `--readable-keys` to opt in.
- `clean` has no force-delete mode and only removes owned rolled-back records.
- `readFile()` was removed from the public API; use bounded reads instead. `findFiles()` and `getAllFiles()` now return the full discovery result (files, diagnostics, limits, `complete`) so unsafe entries cannot be silently dropped.
- Redacted reports no longer carry a value digest, and `valueSalt` was removed from the report schema.
- Adjacent `.i18n-hunter.bak` files were replaced by managed transaction state.
- Node.js 20.19 or newer is required.
- Version 0.1 reports must be regenerated.

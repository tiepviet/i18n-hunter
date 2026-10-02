# Security Model

## Trust boundaries

Reports, manifests, source paths, and translation keys are untrusted input even when a user generated them locally.

## Filesystem policy

- Source paths must be portable relative paths under the canonical project root.
- Existing path components and source files must not be symlinks.
- Symlinks encountered anywhere inside a scanned tree produce an error diagnostic, so they cannot hide files behind an `incomplete`-looking clean scan.
- The managed state directory is excluded from discovery and rejected as an apply target regardless of its name.
- Reports allow only supported source extensions.
- State roots are dedicated, project-marked directories; non-empty unowned directories are refused.
- State roots, `transactions`, transaction directories, manifests, latest pointers, backups, and lock files reject symlink components.
- Manifests store only project-relative source paths and transaction-relative backups bound to those source paths.
- Exclusive PID/token locks detect and recover locks left by dead processes.
- Locks are published atomically via a hard link so a lock file is never observed half-written; the record carries the owning hostname so a lock from another host is treated as stale.

## Transformation policy

- Findings contain end-exclusive UTF-16 ranges, file/slice hashes, and (only for opted-in value reports) value digests.
- Apply verifies the complete file, every exact source slice, and a fresh AST reparse of all structural metadata.
- Findings are schema-validated and duplicate/overlapping ranges are rejected.
- Every planned edit is applied right-to-left against the original source, so no edit can shift the offsets of another.
- Sibling and nested component edits are validated by reparsing the fully generated source before it is written.
- Translation keys have a closed grammar and are never interpolated as raw code.
- Generated React and Vue source is parsed or compiled before any commit.
- Unsupported component scopes fail instead of guessing a hook location.

## Transaction policy

- All reports and files are preflighted before state is created.
- Backups are hash-verified before source mutation.
- A prepared manifest is persisted before writes, so an interrupted commit never leaves an unlabelled transaction directory behind.
- Per-file writes are atomic.
- A failed commit automatically restores already-written files, and refuses to restore any file whose current content matches neither its recorded before-hash nor its after-hash, so a concurrent third-party edit is never overwritten.
- Rollback accepts idempotent retries, records `rolling_back` progress, and verifies every current source and backup hash again immediately before each restore.
- Extending a transaction requires a valid applied parent chain and verified parent backups.
- Clean cannot delete source paths, bypass active recovery, or recursively remove an arbitrary state directory. It may only remove rolled-back records and manifest-less residue.

## Privacy

- Source values and readable value-derived key segments are omitted by default.
- Redacted reports still contain paths, scopes, categories, and structural metadata; these remain sensitive metadata.
- `--readable-keys`, `--include-values` reports, and complete backups must be treated as sensitive source code.
- The library does not emit telemetry or make network requests.

## Release security

- CI tests supported Node versions and macOS/Windows path behavior.
- Packed artifacts are installed into a clean React-only environment before publication.
- Actions are pinned to commit SHAs.
- npm publication uses provenance and an OIDC trusted-publishing environment.
- Dependency audit is a release gate.

## Out of scope

This is not a sandbox for hostile code. Do not run it concurrently with an editor or build process that mutates the same files. Source and state paths are revalidated immediately before access, but a hostile same-user process that can continuously replace verified paths or rewrite owned transaction state remains outside the threat model.

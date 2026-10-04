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
- Directory permissions (`0700`/`0600`) are enforced on POSIX; on Windows ACLs cannot
  represent POSIX modes, so state/backups rely on the user's profile directory
  protections. Keep the state directory on encrypted local storage and do not commit it.
- State roots, `transactions`, transaction directories, manifests, latest pointers, backups, and lock files reject symlink components.
- Bounded file reads (`bounded-read`/`safe-json`) open with `O_NOFOLLOW` where available and verify the opened file descriptor matches the pre-open `lstat` via `dev`/`ino`.
- Manifests store only project-relative source paths and transaction-relative backups bound to those source paths.
- Exclusive PID/token locks detect and recover locks left by dead processes on the same host.
- Locks are published atomically via a hard link so a lock file is never observed half-written; the record carries the owning hostname, PID, and token, which are surfaced on contention. Cross-host locks and corrupt locks are never treated as stale and require manual recovery, so shared filesystems cannot break mutual exclusion.
- Backups are written with restrictive `0600` permissions and hash-verified before source mutation; automatic rollback verifies the backup hash before overwriting any source file.
- Restored source files are mode-sanitized to the `0o644` subset: group/other-writable and executable bits are intentionally stripped (`0o755`/`0o777` restore as `0o644`; backups stay `0o600`). This trades away preserving `+x` for fail-closed restores — re-apply `chmod +x` manually if a source file must stay executable.

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
- The CLI version falls back to a hardcoded `FALLBACK_VERSION` when the build-time define is unavailable (e.g. vitest/tsx); `version-sync.test.ts` keeps it in sync with `package.json`.

## Out of scope

This is not a sandbox for hostile code. Do not run it concurrently with an editor or build process that mutates the same files. Source and state paths are revalidated immediately before access, but a hostile same-user process that can continuously replace verified paths or rewrite owned transaction state remains outside the threat model.

## Windows symlink limitation

On Windows `O_NOFOLLOW` is unavailable (`constants.O_NOFOLLOW` is undefined, so the open flag falls back to `0`) and `stat.dev`/`stat.ino` are both `0`, so the `dev`/`ino` comparison that detects symlink swaps on POSIX is vacuous. Bounded reads mitigate this with a best-effort post-open `lstat` re-check: if `dev`/`ino` are both `0`, the path is re-`lstat`ed after `open` and rejected when it is currently a symlink or no longer a regular file. This narrows but does not fully close the TOCTOU window — a symlink swapped in after the re-check can still be followed. Do not run against an actively hostile same-user filesystem on Windows; keep project and state directories on trusted local storage.

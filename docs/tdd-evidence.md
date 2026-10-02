# TDD Evidence — 0.2 Safety Remediation

## Scope

This implementation was derived from the full repository audit. No external `*.plan.md` was used.

## User journeys

1. As a developer, I can scan Vue/React projects without valid source files being counted as clean.
2. As a reviewer, I can edit one canonical key list and receive deterministic JSON/Markdown output.
3. As a developer, I can preview and apply exact AST-derived edits without corrupting same-line or expression syntax.
4. As a developer, I can recover from repeated applies, partial writes, and interrupted commits.
5. As a package consumer, React-only installation works without optional Vue compiler peers.
6. As a maintainer, malformed reports, paths, keys, manifests, symlinks, and partial scans fail closed.

## RED evidence

Focused tests were run before implementation. Intended failures included:

- Missing canonical path/report/key/discovery modules.
- Missing `parseReactSource`, `parseVueSource`, and `createFileTransformPlan` APIs.
- Existing `applyReport` tests failed before transactional options and safety behavior existed.
- CLI parser/runner tests failed because those modules did not exist.
- Packed React-only install previously failed to load `@vue/compiler-sfc`.
- Existing source was manually reproduced generating nested `t(t(...))`, invalid JSX expressions, and lost rollback points.
- Post-review regressions reproduced aliased-hook generation, parenthesized concise arrows, structural report tampering, child state symlinks, contradictory completeness flags, and interrupted-rollback retries.
- A third review reproduced cross-component offset corruption (`const { t } = useT` interleaved with `ransla{t(...)} Inner )`), a long source path overflowing the key length ceiling into a raw `ZodError`, absolute paths leaking into report diagnostics, `$` sequences corrupting dry-run diff headers, and a report omitting an AST-derived finding passing apply.

Representative RED command:

```text
npx vitest run src/__tests__/react-parser.test.ts src/__tests__/vue-parser.test.ts src/__tests__/scanner.integration.test.ts
Test Files 3 failed; Tests 13 failed
```

Representative transaction RED command:

```text
npx vitest run src/__tests__/applier.test.ts
Test Files 1 failed; Tests 8 failed
```

## GREEN evidence

### Full release gate

```text
npm run verify
```

Result:

- Prettier check: PASS
- ESLint: PASS
- TypeScript: PASS
- Vitest: 19 files, 116 tests PASS
- Coverage: 83.20% statements, 73.35% branches, 90.44% functions, 86.57% lines
- CLI subprocess smoke: PASS
- Packed-package smoke: PASS
- Production dependency audit: 0 vulnerabilities
- Full dependency audit after the final override: 0 vulnerabilities

### Installed package proof

`npm run test:package` packs and installs the artifact into a clean temporary consumer, then proves:

- ESM import succeeds without Vue peers.
- CommonJS require succeeds without Vue peers.
- A Node16 `.cts` consumer resolves the CommonJS declaration condition.
- The React CLI scans and applies a React fixture.
- The optional Vue peers are absent during React-only startup.
- Installing Vue peers allows Vue SFC scan/apply.

### Example builds

Both example applications were installed and built with Vite:

```text
examples/react-app: PASS
examples/vue-app: PASS
```

## Test specification

|   # | Guarantee                                                           | Evidence                                                        | Type                 | Result |
| --: | ------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------- | ------ |
|   1 | Report paths, symlinks, and backups cannot escape roots             | `path-policy.test.ts`, `security.integration.test.ts`           | Unit/integration     | PASS   |
|   2 | Reports and manifests are strict, bounded, internally consistent    | `report-schema.test.ts`, `security.integration.test.ts`         | Unit/security        | PASS   |
|   3 | Default and explicit discovery exclude generated/test/backup files  | `discovery.integration.test.ts`                                 | Integration          | PASS   |
|   4 | Vue and React findings use exact AST ranges                         | `vue-parser.test.ts`, `react-parser.test.ts`                    | Unit                 | PASS   |
|   5 | Existing translations and technical values are not findings         | `react-parser.test.ts`                                          | Unit                 | PASS   |
|   6 | Same-line and expression edits compile after transform              | `transform.integration.test.ts`                                 | Integration          | PASS   |
|   7 | React/Vue injection is component-scoped and idempotent              | `inject.integration.test.ts`                                    | Integration          | PASS   |
|   8 | Unsupported scopes are explicit, not guessed                        | `inject.integration.test.ts`, scanner tests                     | Integration          | PASS   |
|   9 | Failed writes and interrupted commits recover every file            | `applier.test.ts`                                               | Fault injection      | PASS   |
|  10 | Repeated transactions roll back to the original chain               | `applier.test.ts`                                               | Integration          | PASS   |
|  11 | CLI flags, help, output, and exit codes are deterministic           | `cli-args.test.ts`, `cli-runner.test.ts`, `cli-smoke.mjs`       | Unit/E2E             | PASS   |
|  12 | Markdown cannot inject raw HTML or stale duplicated findings        | `markdown-safety.test.ts`, `sync-report.test.ts`                | Security/integration | PASS   |
|  13 | Packed package starts without optional Vue peers                    | `package-smoke.mjs`                                             | Release E2E          | PASS   |
|  14 | Report structure is re-derived from the current AST                 | `applier.test.ts`                                               | Security/integration | PASS   |
|  15 | State ownership, child symlinks, locks, and cleanup are fail-closed | `security.integration.test.ts`                                  | Security             | PASS   |
|  16 | Redacted reports use opaque keys and omit value digests             | `scanner.test.ts`, `report-schema.test.ts`                      | Privacy              | PASS   |
|  17 | Sibling/nested component edits keep their original offsets          | `inject.integration.test.ts`                                    | Correctness          | PASS   |
|  18 | State directory is never scanned nor applied                        | `discovery.integration.test.ts`, `security.integration.test.ts` | Security             | PASS   |
|  19 | Symlinks inside a scanned tree mark the scan incomplete             | `discovery.integration.test.ts`                                 | Security             | PASS   |
|  20 | Manifest-less transaction residue is cleanable                      | `security.integration.test.ts`                                  | Reliability          | PASS   |
|  21 | CRLF sources keep CRLF after injection                              | `transform.integration.test.ts`                                 | Correctness          | PASS   |
|  22 | Technical/dynamic Vue bound attributes are not findings             | `vue-parser.test.ts`                                            | Correctness          | PASS   |

## Intentional boundaries

- Class React components, utility modules without a proven translation binding, Vue Options API scripts, and external SFC blocks are reported unsupported rather than modified unsafely.
- Locale catalog generation is outside the source-transform contract and is documented explicitly.
- Multi-file commit uses per-file atomic rename plus a recoverable journal; it does not claim a single OS-level transaction.

## Merge evidence

No checkpoint commits were created during implementation. This report preserves the RED/GREEN evidence in the working branch. The final release gate is `npm run verify`.

# Roadmap

## 0.2 release objective

Ship a safe, verifiable core for Vue templates, React function components, Vue `<script setup>`, report review, and recoverable source transactions. No critical/high audit finding is accepted as deferred without an explicit unsupported diagnostic.

## Next iterations

1. **Vue Options API support**
   - Add AST-backed `setup()` integration and `this.t` method-scope transforms.
   - Expand compile and runtime fixtures before enabling automatic mutation.

2. **React class and wrapper support**
   - Class components and render functions outside a proven component scope remain
     rejected as `E_UNSUPPORTED_TRANSFORM`.
   - Direct and `export const X = memo(…)` / `forwardRef` / `observer` wrappers with
     a statically resolvable inner function are supported; ambiguous wrappers
     are still rejected until identity and scope tracking are proven.

3. **Locale catalog integration**
   - Detect Vue I18n and i18next resource formats.
   - Add opt-in locale-template generation and collision reporting.
   - Never infer translations silently.

4. **Parser expansion**
   - Add fixtures for decorators, import attributes, SFC external blocks, macro syntax, and framework-specific compiler syntax.
   - Prefer diagnostics over silent regex fallback.

5. **Performance**
   - Add benchmark fixtures for 1k, 10k, and 100k files.
   - Preserve current hard limits and report scan throughput and skipped work.

## Support expansion gate

A new framework/component mode is enabled only when it has:

- real-filesystem fixtures,
- exact-range and hash tests,
- malformed-input diagnostics,
- generated-source parse/compile tests,
- import/directive collision tests,
- package smoke coverage, and
- rollback/failure-injection coverage.

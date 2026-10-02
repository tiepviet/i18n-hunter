# Report Schema v2

Reports are strict runtime-validated JSON. Unknown fields, invalid hashes, duplicate IDs/ranges, malformed paths, inconsistent summaries, and legacy duplicated reports are rejected.

## Top level

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-09-25T00:00:00.000Z",
  "complete": true,
  "scan": {
    "paths": ["src"],
    "includePatterns": ["**/*.{vue,ts,tsx,js,jsx}"],
    "excludePatterns": ["**/node_modules/**"],
    "limits": {
      "maxFileBytes": 2000000,
      "maxFiles": 10000,
      "maxTotalBytes": 100000000,
      "maxFindings": 10000,
      "maxDepth": 50
    }
  },
  "summary": {},
  "findings": [],
  "diagnostics": []
}
```

## Finding

```json
{
  "id": "finding-<sha256>",
  "filePath": "src/App.tsx",
  "fileSha256": "<64 lowercase hex characters>",
  "sliceSha256": "<64 lowercase hex characters>",
  "valueSha256": "<64 lowercase hex characters; present only with --include-values>",
  "hardcodedString": "Optional local-review value",
  "lineNumber": 10,
  "columnNumber": 20,
  "endLineNumber": 10,
  "endColumnNumber": 30,
  "suggestedKey": "src.app.btn.save_changes",
  "context": "tag:button",
  "category": "button",
  "transform": "react-jsx-text",
  "range": { "start": 120, "end": 134 },
  "component": {}
}
```

`hardcodedString` and `valueSha256` are omitted in redacted reports, and suggested keys are opaque random identifiers unless the report was produced with `--readable-keys`. The exact source range and file/slice hashes remain sufficient for safe apply without publishing a value-derived digest.

## Editable fields

Only `suggestedKey` is intended for manual editing. It must match:

```text
^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,14}$
```

Changing structural fields invalidates schema/hash/range invariants. Before writing anything, `apply` also reparses each source file and requires every structural field, stable ID, component range, transform, context, and salted value digest to match the current AST.

## Diagnostics

Diagnostics use stable `E_*` codes and relative paths. Absolute paths, source excerpts, and stack traces are not serialized. A scan with an error diagnostic has `complete: false`; `apply` refuses incomplete reports.

## Compatibility

Version 0.1 reports used duplicated `results` and `categorizedResults` collections. They are intentionally not accepted by `apply` or `sync`; regenerate them with 0.2.x.

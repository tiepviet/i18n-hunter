import type { ExtractionReport, ScanResult } from '../../types.js'

const finding: ScanResult = {
  id: 'finding-1',
  filePath: 'src/App.tsx',
  fileSha256: 'a'.repeat(64),
  sliceSha256: 'b'.repeat(64),
  valueSha256: 'c'.repeat(64),
  hardcodedString: 'Hello world',
  lineNumber: 2,
  columnNumber: 12,
  endLineNumber: 2,
  endColumnNumber: 23,
  suggestedKey: 'app.lbl.hello_world',
  context: 'tag:div',
  category: 'label',
  transform: 'react-jsx-text',
  range: { start: 40, end: 51 },
  component: {
    id: 'component-app',
    name: 'App',
    start: 0,
    end: 100,
    bodyStart: 25,
    kind: 'react-function',
  },
}

export function createReport(): ExtractionReport {
  return {
    schemaVersion: 2,
    generatedAt: '2026-09-25T00:00:00.000Z',
    complete: true,
    scan: {
      paths: ['src'],
      includePatterns: ['**/*.{vue,ts,tsx,js,jsx}'],
      excludePatterns: [],
      limits: {
        maxFileBytes: 2_000_000,
        maxFiles: 10_000,
        maxTotalBytes: 100_000_000,
        maxFindings: 10_000,
        maxDepth: 50,
      },
    },
    summary: {
      filesDiscovered: 1,
      filesScanned: 1,
      findings: 1,
      categories: {
        label: 1,
        button: 0,
        message: 0,
        error: 0,
        notification: 0,
      },
      diagnostics: { error: 0, warning: 0, info: 0 },
    },
    findings: [finding],
    diagnostics: [],
  }
}

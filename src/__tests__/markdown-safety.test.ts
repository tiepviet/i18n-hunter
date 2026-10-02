import { describe, expect, it } from 'vitest'
import { generateMarkdownReport } from '../report-formatter.js'
import { createReport } from './helpers/report-fixtures.js'

describe('markdown report safety', () => {
  it('renders untrusted values without raw HTML or formatting injection', () => {
    const report = structuredClone(createReport())
    report.findings[0].hardcodedString =
      '<img src=x onerror=alert(1)> `code` [link](javascript:alert(1))'

    const markdown = generateMarkdownReport(report)

    expect(markdown).not.toContain('<img')
    expect(markdown).not.toContain('[link](javascript:')
    expect(markdown).toContain('&lt;img')
  })

  it('escapes diagnostic paths and messages', () => {
    const report = structuredClone(createReport())
    report.diagnostics = [
      {
        severity: 'error',
        code: 'E_PARSE_FAILED',
        message: '<script>alert(1)</script>\nInjected heading',
        filePath: 'src/App.tsx',
      },
    ]
    report.summary.diagnostics.error = 1
    report.complete = false

    const markdown = generateMarkdownReport(report)
    expect(markdown).not.toContain('<img')
    expect(markdown).not.toContain('<script>')
    expect(markdown).toContain('&lt;script&gt;')
  })

  it('uses the report generation time rather than the current time', () => {
    const markdown = generateMarkdownReport(createReport())
    expect(markdown).toContain('2026-09-25T00:00:00.000Z')
  })

  it('renders redacted values without source text', () => {
    const report = structuredClone(createReport())
    report.findings[0].hardcodedString = undefined

    const markdown = generateMarkdownReport(report)

    expect(markdown).not.toContain('Hello world')
    expect(markdown).toContain('redacted')
  })
})

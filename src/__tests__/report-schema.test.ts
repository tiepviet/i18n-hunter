import { describe, expect, it } from 'vitest'
import { ExtractionReportSchema, parseExtractionReport } from '../report-schema.js'
import { createReport } from './helpers/report-fixtures.js'

describe('extraction report schema', () => {
  it('accepts a canonical v2 report', () => {
    expect(parseExtractionReport(createReport())).toEqual(createReport())
  })

  it('rejects legacy duplicated reports', () => {
    expect(() => parseExtractionReport({ totalFiles: 1, totalStrings: 1, results: [] })).toThrow()
  })

  it('rejects unknown fields and prototype-like keys', () => {
    const report = { ...createReport(), unexpected: true }
    expect(() => parseExtractionReport(report)).toThrow()

    const polluted = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(() => parseExtractionReport(polluted)).toThrow()
  })

  it('rejects duplicate finding ids and invalid ranges', () => {
    const report = createReport()
    const duplicate = { ...report, findings: [report.findings[0], report.findings[0]] }
    expect(() => parseExtractionReport(duplicate)).toThrow(/duplicate/i)

    const invalidRange = structuredClone(report)
    invalidRange.findings[0].range.end = invalidRange.findings[0].range.start - 1
    expect(() => parseExtractionReport(invalidRange)).toThrow()
  })

  it('rejects complete=true when error diagnostics exist', () => {
    const report = structuredClone(createReport())
    report.diagnostics.push({
      severity: 'error',
      code: 'E_PARSE_FAILED',
      message: 'Synthetic parse failure',
    })
    report.summary.diagnostics.error = 1
    report.complete = true

    expect(() => parseExtractionReport(report)).toThrow(/complete/i)
  })

  it('rejects unsafe diagnostic paths', () => {
    const report = structuredClone(createReport())
    report.diagnostics = [
      {
        severity: 'error',
        code: 'E_PARSE_FAILED',
        message: 'Synthetic failure',
        filePath: '<img src=x onerror=alert(1)>.ts',
      },
    ]
    report.summary.diagnostics.error = 1
    report.complete = false

    expect(() => parseExtractionReport(report)).toThrow(/diagnostic|path|relative/i)
  })

  it('rejects inconsistent summary totals', () => {
    const report = structuredClone(createReport())
    report.summary.findings = 2
    expect(() => parseExtractionReport(report)).toThrow(/summary/i)
  })

  it('exports a schema usable by consumers', () => {
    expect(ExtractionReportSchema.safeParse(createReport()).success).toBe(true)
  })
})

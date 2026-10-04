import { describe, expect, it } from 'vitest'
import { ExtractionReportSchema, parseExtractionReport } from '../report-schema.js'
import { stableFindingId } from '../report-verification.js'
import { hashText } from '../source-range.js'
import { createFileTransformPlan } from '../transform.js'
import type { ScanResult } from '../types.js'
import { parseVueSource } from '../vue-parser.js'
import { createReport } from './helpers/report-fixtures.js'

describe('uppercase attribute contexts', () => {
  it.each(['attribute:myProp', 'attribute:Title'])('accepts schema context %s', (context) => {
    const report = structuredClone(createReport())
    report.findings[0]!.context = context
    expect(() => parseExtractionReport(report)).not.toThrow()
    expect(ExtractionReportSchema.safeParse(report).success).toBe(true)
  })

  it('still rejects contexts with unsafe characters', () => {
    for (const context of ['attribute:has space', 'attribute:<img>', 'attribute:semi;colon']) {
      const report = structuredClone(createReport())
      report.findings[0]!.context = context
      expect(ExtractionReportSchema.safeParse(report).success).toBe(false)
    }
  })

  it('preserves Vue prop case through schema and transform (:Title)', async () => {
    const source = `<template><MyComp Title="Hello World" /></template>`
    const filePath = 'src/Card.vue'
    const parsed = await parseVueSource(source, filePath)
    expect(parsed.candidates.length).toBeGreaterThan(0)
    expect(parsed.candidates.some((item) => item.context === 'attribute:Title')).toBe(true)

    const fileHash = hashText(source)
    const findings: ScanResult[] = parsed.candidates.map((candidate, index) => {
      const raw = source.slice(candidate.range.start, candidate.range.end)
      return {
        id: stableFindingId(filePath, candidate.range, raw),
        filePath,
        fileSha256: fileHash,
        sliceSha256: hashText(raw),
        lineNumber: candidate.lineNumber,
        columnNumber: candidate.columnNumber,
        endLineNumber: candidate.endLineNumber,
        endColumnNumber: candidate.endColumnNumber,
        suggestedKey: `test.lbl.case${index}`,
        context: candidate.context,
        category: candidate.category,
        transform: candidate.transform,
        range: candidate.range,
        component: candidate.component,
        isNotification: candidate.isNotification,
        notificationType: candidate.notificationType,
      }
    })

    const report = structuredClone(createReport())
    report.findings = findings
    report.summary.findings = findings.length
    report.summary.categories = { label: 0, button: 0, message: 0, error: 0, notification: 0 }
    for (const finding of findings) report.summary.categories[finding.category] += 1
    const parsedReport = parseExtractionReport(report)

    const plan = await createFileTransformPlan(source, filePath, parsedReport.findings)
    expect(plan.content).toContain(':Title="$t(')
    expect(plan.content).not.toContain(':title="$t(')
  })
})

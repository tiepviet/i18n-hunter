import { afterEach, describe, expect, it } from 'vitest'
import { exportReport, generateJsonReport, generateSummary } from '../report-formatter.js'
import { createReport } from './helpers/report-fixtures.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('report formatter', () => {
  it('generates valid canonical JSON and a truthful summary', () => {
    const report = createReport()
    const parsed = JSON.parse(generateJsonReport(report))
    expect(parsed.schemaVersion).toBe(2)
    expect(generateSummary(report)).toContain('Hardcoded strings:     1')
  })

  it('exports only safe report filenames', () => {
    project = createTempProject()
    expect(() =>
      exportReport(createReport(), {
        outputDir: project!.root,
        filename: '../escape',
        json: true,
        markdown: false,
      }),
    ).toThrow(/filename/i)
  })

  it('suffixes colliding report filenames instead of overwriting', () => {
    project = createTempProject()
    const first = exportReport(createReport(), {
      outputDir: project!.root,
      filename: 'report',
      json: true,
      markdown: false,
    })
    const second = exportReport(createReport(), {
      outputDir: project!.root,
      filename: 'report',
      json: true,
      markdown: false,
    })
    expect(first[0]).toMatch(/report\.json$/u)
    expect(second[0]).toMatch(/report-1\.json$/u)
  })
})

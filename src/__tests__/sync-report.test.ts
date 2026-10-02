import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncReportMd } from '../sync-report.js'
import { createReport } from './helpers/report-fixtures.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('syncReportMd', () => {
  it('renders the canonical edited finding list deterministically', () => {
    project = createTempProject()
    const report = createReport()
    report.findings[0]!.suggestedKey = 'edited.user.key'
    const reportPath = project.write('report.json', JSON.stringify(report))

    const first = syncReportMd(reportPath)
    const firstBytes = readFileSync(first.mdPath, 'utf8')
    const second = syncReportMd(reportPath)

    expect(first.findingsRendered).toBe(1)
    expect(firstBytes).toContain('edited.user.key')
    expect(readFileSync(second.mdPath, 'utf8')).toBe(firstBytes)
  })

  it('rejects malformed JSON without replacing existing Markdown', () => {
    project = createTempProject()
    const reportPath = project.write('report.json', '{bad json')
    const markdownPath = project.write('report.md', 'existing report')
    project.write('report.json', '{bad json')

    expect(() => syncReportMd(reportPath)).toThrow()
    expect(readFileSync(markdownPath, 'utf8')).toBe('existing report')
  })

  it('rejects legacy reports instead of trusting stale category copies', () => {
    project = createTempProject()
    const reportPath = project.write('report.json', JSON.stringify({ totalFiles: 1, results: [] }))

    expect(() => syncReportMd(reportPath)).toThrow(/schema|report/i)
    expect(existsSync(join(project.root, 'report.md'))).toBe(false)
  })
})

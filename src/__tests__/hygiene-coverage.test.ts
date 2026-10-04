import { existsSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { safeMessage } from '../errors.js'
import { syncReportMd } from '../sync-report.js'
import { packageVersion } from '../version.js'
import { createReport } from './helpers/report-fixtures.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => {
  project?.cleanup()
  project = undefined
})

describe('hygiene coverage (R5)', () => {
  it('strips case-variant .JSON extension via extname-aware basename', () => {
    expect(basename('REPORT.JSON', extname('REPORT.JSON'))).toBe('REPORT')
  })

  it('syncReportMd round-trips REPORT.JSON to REPORT.md', () => {
    project = createTempProject()
    const report = createReport()
    const jsonPath = project.write('REPORT.JSON', JSON.stringify(report))

    const result = syncReportMd(jsonPath)

    expect(result.mdPath.endsWith('REPORT.md')).toBe(true)
    expect(existsSync(result.mdPath)).toBe(true)
    expect(result.findingsRendered).toBe(report.findings.length)
  })

  it('safeMessage truncates long input with marker and leaves short input unchanged', () => {
    const short = 'oops'
    expect(safeMessage(new Error(short))).toBe(short)

    const long = 'x'.repeat(2000)
    const truncated = safeMessage(new Error(long))
    expect(truncated.length).toBe(1000 + '… (truncated)'.length)
    expect(truncated.length).toBeLessThan(long.length)
    expect(truncated).toContain('… (truncated)')
  })

  it('packageVersion returns a non-empty string', () => {
    expect(typeof packageVersion()).toBe('string')
    expect(packageVersion().length).toBeGreaterThan(0)
  })
})

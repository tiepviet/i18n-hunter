import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyReport } from '../applier.js'
import { HunterError } from '../errors.js'
import { parseManifest } from '../manifest-schema.js'
import { parseExtractionReport } from '../report-schema.js'
import { exportReport } from '../report-formatter.js'
import { scanForHardcodedStrings } from '../scanner.js'
import { createReport } from './helpers/report-fixtures.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined
afterEach(() => project?.cleanup())

function validManifestEntry(filePath = 'src/App.tsx', mode = 0o644) {
  return {
    filePath,
    backupPath: `backups/${filePath}`,
    beforeHash: 'a'.repeat(64),
    afterHash: 'b'.repeat(64),
    mode,
  }
}

function validManifest(entries: unknown[]) {
  return {
    schemaVersion: 2,
    transactionId: '11111111-1111-4111-8111-111111111111',
    state: 'prepared',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    projectRootHash: 'a'.repeat(64),
    reportHash: 'b'.repeat(64),
    parentTransactionId: null,
    entries,
  }
}

describe('p1 caps', () => {
  it('truncates a 200-issue manifest error below 4KB', () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      ...validManifestEntry(`bad${i}.txt`),
      backupPath: `backups/bad${i}.txt`,
    }))
    let error: unknown
    try {
      parseManifest(validManifest(entries))
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(HunterError)
    const hunter = error as HunterError
    expect(hunter.code).toBe('E_MANIFEST_SCHEMA')
    expect(hunter.message.length).toBeLessThan(4096)
    expect(hunter.message).toMatch(/\+19\d more|more/)
  })

  it('truncates a 200-issue report error below 4KB', () => {
    const base = createReport().findings[0]!
    const findings = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      id: `finding-evil-${i}`,
      suggestedKey: 'x',
      range: { start: i * 100, end: i * 100 + 10 },
    }))
    const report = {
      ...createReport(),
      findings,
      summary: {
        ...createReport().summary,
        findings: 200,
        categories: { label: 200, button: 0, message: 0, error: 0, notification: 0 },
      },
    }
    let error: unknown
    try {
      parseExtractionReport(report)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(HunterError)
    const hunter = error as HunterError
    expect(hunter.code).toBe('E_REPORT_SCHEMA')
    expect(hunter.message.length).toBeLessThan(4096)
    expect(hunter.message).toMatch(/more/)
  })

  it('rejects executable/world-writable modes at the schema', () => {
    for (const bad of [0o755, 0o777, 0o711, 0o666]) {
      expect(() => parseManifest(validManifest([validManifestEntry('src/App.tsx', bad)]))).toThrow(
        expect.objectContaining({ code: 'E_MANIFEST_SCHEMA' }),
      )
    }
    for (const good of [0o600, 0o640, 0o644, 0o444, 0o400]) {
      expect(() =>
        parseManifest(validManifest([validManifestEntry('src/App.tsx', good)])),
      ).not.toThrow()
    }
  })

  it('caps large dry-run diffs with a placeholder', async () => {
    project = createTempProject('i18n-hunter-p1-')
    const fileCount = 12
    for (let i = 0; i < fileCount; i += 1) {
      // Trailing (not leading) padding: leading `//` blocks shift the import
      // insertion point in planReactBindings, which is out of scope here.
      const padding = '// padding line for diff-cap test\n'.repeat(16_000)
      project.write(
        `src/App${i}.tsx`,
        `export const App${i} = () => <div>Message number ${i}</div>\n${padding}`,
      )
    }
    const report = await scanForHardcodedStrings(
      {
        scanPaths: ['src'],
        limits: { maxFileBytes: 10_000_000, maxTotalBytes: 500_000_000 },
      },
      project.root,
    )
    expect(report.findings.length).toBe(fileCount)
    exportReport(report, {
      outputDir: project.root,
      filename: 'report',
      json: true,
      markdown: false,
    })
    const result = await applyReport(join(project.root, 'report.json'), {
      basePath: project.root,
      stateDir: '.state',
      dryRun: true,
    })
    expect(result.modifiedFiles).toHaveLength(fileCount)
    expect(result.diffs).toHaveLength(fileCount)
    for (const diff of result.diffs) {
      expect(diff).toContain('diff omitted')
      expect(diff.length).toBeLessThan(10_000)
    }
  }, 120_000)
})

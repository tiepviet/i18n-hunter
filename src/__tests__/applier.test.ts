import { chmodSync, existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyReport, cleanTransactions, rollbackTransactions } from '../applier.js'
import { exportReport } from '../report-formatter.js'
import { scanForHardcodedStrings } from '../scanner.js'
import { hashText } from '../source-range.js'
import { createFileTransformPlan } from '../transform.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

async function reportFor(path: string, content: string) {
  project!.write(path, content)
  const report = await scanForHardcodedStrings(
    { scanPaths: ['src'], includeValues: true },
    project!.root,
  )
  const reportPath = join(project!.root, 'report.json')
  exportReport(report, {
    outputDir: project!.root,
    filename: 'report',
    json: true,
    markdown: false,
  })
  return reportPath
}

describe('apply transactions', () => {
  it('rejects report path traversal before writing anything', async () => {
    project = createTempProject()
    const original = project.write('outside.ts', 'const original = "Outside project"')
    project.write('src/Inside.tsx', 'export const Inside = () => <div>Inside project</div>')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const tampered = structuredClone(report)
    tampered.findings[0] = {
      ...tampered.findings[0]!,
      filePath: '../outside.ts',
    }
    const reportPath = project.write('report.json', JSON.stringify(tampered))

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow()
    expect(readFileSync(original, 'utf8')).toContain('Outside project')
    expect(existsSync(join(project.root, '.state'))).toBe(false)
  })

  it('rejects invalid translation keys before writing anything', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    report.findings[0]!.suggestedKey = "safe'); globalThis.pwned = true; //"
    const reportPath = project.write('report.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/key|schema|pattern/i)
    expect(project.read('src/App.tsx')).toContain('<div>Hello</div>')
    expect(existsSync(join(project.root, '.state'))).toBe(false)
  })

  it('rejects symlink source paths', async () => {
    project = createTempProject()
    const outside = createTempProject('i18n-hunter-outside-')
    outside.write('src/Secret.tsx', 'export const Secret = () => <div>Secret outside</div>')
    project.mkdir('src')
    symlinkSync(outside.root, join(project.root, 'src/linked'), 'dir')
    const reportPath = join(outside.root, 'report.json')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, outside.root)
    // Rewrite the path while keeping all other report invariants valid.
    report.findings[0]!.filePath = 'src/linked/Secret.tsx'
    report.findings[0]!.fileSha256 = report.findings[0]!.fileSha256
    report.findings[0]!.sliceSha256 = report.findings[0]!.sliceSha256
    writeFileSync(reportPath, JSON.stringify(report), 'utf8')

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/symlink/i)
    expect(outside.read('src/Secret.tsx')).toContain('Secret outside')
    outside.cleanup()
  })

  it('reparses and rejects tampered structural report fields', async () => {
    project = createTempProject()
    const source = 'export const App = () => <div>Structural message</div>'
    project.write('src/App.tsx', source)
    const report = await scanForHardcodedStrings(
      { scanPaths: ['src'], includeValues: true },
      project.root,
    )
    report.findings[0]!.transform = 'script-string'
    const reportPath = project.write('tampered.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/structure|transform|ast|report/i)
    expect(project.read('src/App.tsx')).toBe(source)
  })

  it('rejects a report that silently omits an AST-derived finding', async () => {
    project = createTempProject()
    project.write(
      'src/App.tsx',
      'export const App = () => <div><span>First message</span><span>Second message</span></div>',
    )
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    report.findings.splice(1, 1)
    report.summary.findings = report.findings.length
    const reportPath = project.write('partial.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/omitted|AST|report/i)
    expect(project.read('src/App.tsx')).toContain('Second message')
  })

  it('rejects a complete flag contradicted by error diagnostics', async () => {
    project = createTempProject()
    const source = 'export const App = () => <div>Visible message</div>'
    project.write('src/App.tsx', source)
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    report.diagnostics.push({
      severity: 'error',
      code: 'E_PARSE_FAILED',
      message: 'Synthetic failure',
    })
    report.summary.diagnostics.error = 1
    report.complete = true
    const reportPath = project.write('inconsistent.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/complete|schema/i)
    expect(project.read('src/App.tsx')).toBe(source)
  })

  it('preserves dollar signs in dry-run diff headers', async () => {
    project = createTempProject()
    const source = 'export const App = () => <div>Diff header message</div>'
    const reportPath = await reportFor('src/a$$b/App.tsx', source)

    const result = await applyReport(reportPath, {
      basePath: project.root,
      stateDir: '.state',
      dryRun: true,
    })

    expect(result.diffs[0]).toContain('a/src/a$$b/App.tsx')
    expect(result.diffs[0]).not.toContain('a/src/a$b/App.tsx')
  })

  it('performs a dry run without creating state or changing source', async () => {
    project = createTempProject()
    const original = 'export const App = () => <div>Hello</div>'
    const reportPath = await reportFor('src/App.tsx', original)

    const result = await applyReport(reportPath, {
      basePath: project.root,
      stateDir: '.state',
      dryRun: true,
    })

    expect(result.modifiedFiles).toEqual(['src/App.tsx'])
    expect(result.diffs[0]).toContain('+')
    expect(project.read('src/App.tsx')).toBe(original)
    expect(existsSync(join(project.root, '.state'))).toBe(false)
  })

  it('restores every file after a mid-transaction write failure', async () => {
    project = createTempProject()
    project.write('src/A.tsx', 'export const A = () => <div>First message</div>')
    project.write('src/B.tsx', 'export const B = () => <div>Second message</div>')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const reportPath = project.write('report.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, {
        basePath: project.root,
        stateDir: '.state',
        testHooks: {
          beforeWrite(_filePath, index) {
            if (index === 1) throw new Error('injected write failure')
          },
        },
      }),
    ).rejects.toThrow(/injected write failure/)

    expect(project.read('src/A.tsx')).toContain('First message')
    expect(project.read('src/B.tsx')).toContain('Second message')
  })

  it('rolls a transaction chain back to the original pre-first-apply source', async () => {
    project = createTempProject()
    const original = 'export const App = () => <div>Original message</div>'
    const firstReport = await reportFor('src/App.tsx', original)
    await applyReport(firstReport, { basePath: project.root, stateDir: '.state' })

    project.write('src/Extra.tsx', 'export const Extra = () => <span>Second message</span>')
    const secondReport = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const secondPath = project.write('report-2.json', JSON.stringify(secondReport))
    await applyReport(secondPath, { basePath: project.root, stateDir: '.state' })

    const rollback = await rollbackTransactions({ basePath: project.root, stateDir: '.state' })

    expect(rollback.restoredFiles).toEqual(['src/App.tsx', 'src/Extra.tsx'])
    expect(project.read('src/App.tsx')).toBe(original)
    expect(project.read('src/Extra.tsx')).toContain('Second message')
  })

  it('refuses rollback when the source changed after apply', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Original message</div>')
    const reportPath = await reportFor('src/App.tsx', project.read('src/App.tsx'))
    await applyReport(reportPath, { basePath: project.root, stateDir: '.state' })
    project.write('src/App.tsx', `${project.read('src/App.tsx')}\n// user edit`)

    await expect(
      rollbackTransactions({ basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/changed|rollback/i)
    expect(project.read('src/App.tsx')).toContain('// user edit')
  })

  it('recovers a prepared transaction after an interrupted multi-file commit', async () => {
    project = createTempProject()
    const originalA = 'export const A = () => <div>First recovery message</div>'
    const originalB = 'export const B = () => <div>Second recovery message</div>'
    project.write('src/A.tsx', originalA)
    project.write('src/B.tsx', originalB)
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const planA = await createFileTransformPlan(
      originalA,
      'src/A.tsx',
      report.findings.filter((item) => item.filePath === 'src/A.tsx'),
    )
    const planB = await createFileTransformPlan(
      originalB,
      'src/B.tsx',
      report.findings.filter((item) => item.filePath === 'src/B.tsx'),
    )
    const transactionId = '11111111-1111-4111-8111-111111111111'
    const transactionRoot = project.mkdir(`.state/transactions/${transactionId}`)
    project.write(
      '.state/.i18n-hunter-state.json',
      JSON.stringify({ schemaVersion: 1, projectRootHash: hashText(project.root) }),
    )
    const backupRoot = project.mkdir(`.state/transactions/${transactionId}/backups/src`)
    writeFileSync(join(backupRoot, 'A.tsx'), originalA, 'utf8')
    writeFileSync(join(backupRoot, 'B.tsx'), originalB, 'utf8')
    writeFileSync(
      join(transactionRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        transactionId,
        state: 'prepared',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRootHash: hashText(project.root),
        reportHash: 'a'.repeat(64),
        parentTransactionId: null,
        entries: [
          {
            filePath: 'src/A.tsx',
            backupPath: 'backups/src/A.tsx',
            beforeHash: planA.originalHash,
            afterHash: planA.finalHash,
            mode: 0o644,
          },
          {
            filePath: 'src/B.tsx',
            backupPath: 'backups/src/B.tsx',
            beforeHash: planB.originalHash,
            afterHash: planB.finalHash,
            mode: 0o644,
          },
        ],
      }),
      'utf8',
    )
    writeFileSync(
      join(project.root, '.state/latest.json'),
      JSON.stringify({ schemaVersion: 2, transactionId }),
      'utf8',
    )
    // Simulate a crash after only the first file was atomically written.
    writeFileSync(join(project.root, 'src/A.tsx'), planA.content, 'utf8')
    project.write('src/C.tsx', 'export const C = () => <div>Third recovery message</div>')
    const nextReport = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const nextReportPath = project.write('next.json', JSON.stringify(nextReport))

    await expect(
      applyReport(nextReportPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/recover|transaction|active/i)

    const result = await rollbackTransactions({ basePath: project.root, stateDir: '.state' })

    expect(result.restoredFiles).toEqual(['src/A.tsx', 'src/B.tsx'])
    expect(project.read('src/A.tsx')).toBe(originalA)
    expect(project.read('src/B.tsx')).toBe(originalB)
  })

  it('validates parent backups before extending a transaction chain', async () => {
    project = createTempProject()
    project.write('src/A.tsx', 'export const A = () => <div>Parent backup message</div>')
    const firstReport = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const firstPath = project.write('first.json', JSON.stringify(firstReport))
    await applyReport(firstPath, { basePath: project.root, stateDir: '.state' })

    const latest = JSON.parse(readFileSync(join(project.root, '.state/latest.json'), 'utf8')) as {
      transactionId: string
    }
    const manifest = JSON.parse(
      readFileSync(
        join(project.root, `.state/transactions/${latest.transactionId}/manifest.json`),
        'utf8',
      ),
    ) as { entries: Array<{ backupPath: string }> }
    writeFileSync(
      join(
        project.root,
        `.state/transactions/${latest.transactionId}/${manifest.entries[0]!.backupPath}`,
      ),
      'corrupt backup',
      'utf8',
    )

    project.write('src/B.tsx', 'export const B = () => <div>Child backup message</div>')
    const secondReport = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const secondPath = project.write('second.json', JSON.stringify(secondReport))
    await expect(
      applyReport(secondPath, { basePath: project.root, stateDir: '.state' }),
    ).rejects.toThrow(/backup|transaction/i)
    expect(project.read('src/B.tsx')).toContain('Child backup message')
  })

  it('cleans transactions with backups in multiple directories', async () => {
    project = createTempProject()
    project.write('src/a/One.tsx', 'export const One = () => <div>One message</div>')
    project.write('src/b/Two.tsx', 'export const Two = () => <div>Two message</div>')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const reportPath = project.write('multi.json', JSON.stringify(report))

    await applyReport(reportPath, { basePath: project.root, stateDir: '.state' })
    await rollbackTransactions({ basePath: project.root, stateDir: '.state' })
    const result = await cleanTransactions({ basePath: project.root, stateDir: '.state' })

    expect(result.removedTransactions).toBe(1)
    expect(existsSync(join(project.root, '.state/transactions'))).toBe(false)
  })

  it('preserves source file modes across apply and rollback', async () => {
    project = createTempProject()
    const sourcePath = project.write(
      'src/App.tsx',
      'export const App = () => <div>Mode message</div>',
    )
    chmodSync(sourcePath, 0o640)
    const reportPath = await reportFor('src/App.tsx', project.read('src/App.tsx'))
    await applyReport(reportPath, { basePath: project.root, stateDir: '.state' })
    expect(statSync(sourcePath).mode & 0o777).toBe(0o640)
    await rollbackTransactions({ basePath: project.root, stateDir: '.state' })
    expect(statSync(sourcePath).mode & 0o777).toBe(0o640)
  })

  it('cleans only managed transaction state after rollback', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Original message</div>')
    const reportPath = await reportFor('src/App.tsx', project.read('src/App.tsx'))
    await applyReport(reportPath, { basePath: project.root, stateDir: '.state' })

    await expect(cleanTransactions({ basePath: project.root, stateDir: '.state' })).rejects.toThrow(
      /rollback|active/i,
    )
    await rollbackTransactions({ basePath: project.root, stateDir: '.state' })
    const result = await cleanTransactions({
      basePath: project.root,
      stateDir: '.state',
    })

    expect(result.removedTransactions).toBeGreaterThan(0)
    expect(existsSync(join(project.root, '.state/transactions'))).toBe(false)
    expect(project.read('src/App.tsx')).toContain('Original message')
  })
})

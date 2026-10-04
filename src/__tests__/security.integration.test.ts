import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyReport, cleanTransactions, rollbackTransactions } from '../applier.js'
import { scanForHardcodedStrings } from '../scanner.js'
import { hashText } from '../source-range.js'
import { atomicWriteFile, sanitizeFileMode } from '../atomic-write.js'
import { parseManifest } from '../manifest-schema.js'
import { readJsonBounded } from '../safe-json.js'
import { resolveStatePaths, withStateLock } from '../transaction-store.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let projects: TempProject[] = []

afterEach(() => {
  for (const project of projects) project.cleanup()
  projects = []
})

function project(prefix?: string): TempProject {
  const created = createTempProject(prefix)
  projects.push(created)
  return created
}

describe('security integration', () => {
  it('rejects oversized and malformed JSON before parsing', () => {
    const temp = project()
    const large = temp.write('large.json', JSON.stringify({ value: 'x'.repeat(200) }))
    expect(() => readJsonBounded(large, 100)).toThrow(/100 bytes/)
    const invalid = temp.write('invalid.json', '{bad')
    expect(() => readJsonBounded(invalid)).toThrow(/Invalid JSON/)
    const duplicate = temp.write('duplicate.json', '{"complete":true,"complete":false}')
    expect(() => readJsonBounded(duplicate)).toThrow(/Invalid JSON/)
  })

  it('rejects symlink state directories', () => {
    const temp = project()
    const outside = project('i18n-hunter-state-outside-')
    symlinkSync(outside.root, join(temp.root, '.state'), 'dir')
    expect(() => resolveStatePaths(temp.root, '.state')).toThrow(/symlink/i)
  })

  it('uses an exclusive transaction lock', () => {
    const temp = project()
    const paths = resolveStatePaths(temp.root, '.state')
    withStateLock(paths, () => {
      expect(() => withStateLock(paths, () => undefined)).toThrow(/active/i)
    })
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('rejects symlinked managed state children', async () => {
    const temp = project()
    const outside = project('i18n-hunter-state-children-outside-')
    temp.mkdir('.state')
    symlinkSync(outside.root, join(temp.root, '.state/transactions'), 'dir')
    temp.write('src/App.tsx', 'export const App = () => <div>Safe message</div>')
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, temp.root)
    const reportPath = temp.write('report.json', JSON.stringify(report))

    await expect(
      applyReport(reportPath, { basePath: temp.root, stateDir: '.state' }),
    ).rejects.toThrow(/symlink|managed state|transactions/i)
    expect(existsSync(join(outside.root, 'transactions'))).toBe(false)
  })

  it('never scans the managed state directory end-to-end, whatever it is named', async () => {
    const temp = project()
    temp.write('src/App.tsx', 'export const App = () => <div>Real message</div>')
    temp.write(
      'hunter-state/transactions/t/backups/src/App.tsx',
      'export const App = () => <div>Real message</div>',
    )

    const report = await scanForHardcodedStrings(
      { scanPaths: ['.'], stateDir: 'hunter-state' },
      temp.root,
    )

    expect(report.summary.filesScanned).toBe(1)
    expect(report.findings.map((item) => item.filePath)).toEqual(['src/App.tsx'])
  })

  it('refuses to apply a report that targets the managed state directory', async () => {
    const temp = project()
    temp.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    temp.write('.state/transactions/t/backups/src/App.tsx', 'export const backup = true')
    const report = await scanForHardcodedStrings(
      { scanPaths: ['.'], stateDir: '.state', includeValues: true },
      temp.root,
    )
    expect(report.findings.some((item) => item.filePath.startsWith('.state'))).toBe(false)

    const forged = structuredClone(report)
    const victim = report.findings[0]!
    forged.findings.push({
      ...victim,
      id: 'finding-' + 'f'.repeat(64),
      filePath: '.state/transactions/t/backups/src/App.tsx',
    })
    forged.summary.findings = forged.findings.length
    forged.summary.categories[victim.category] += 1
    const reportPath = temp.write('report.json', JSON.stringify(forged))

    await expect(
      applyReport(reportPath, { basePath: temp.root, stateDir: '.state' }),
    ).rejects.toThrow(/not an apply target/i)
  })

  it('refuses destructive operations on an arbitrary project state directory', async () => {
    const temp = project()
    temp.mkdir('transactions/keep-me')
    writeFileSync(join(temp.root, 'transactions/keep-me/data.txt'), 'project data', 'utf8')

    await expect(
      cleanTransactions({ basePath: temp.root, stateDir: '.', all: true }),
    ).rejects.toThrow(/state|owned|managed/i)
    expect(readFileSync(join(temp.root, 'transactions/keep-me/data.txt'), 'utf8')).toBe(
      'project data',
    )
  })

  it('recovers a lock left by a dead process', () => {
    const temp = project()
    const paths = resolveStatePaths(temp.root, '.state')
    temp.mkdir('.state')
    writeFileSync(paths.lock, JSON.stringify({ pid: 999_999, token: 'stale' }), 'utf8')

    expect(() => withStateLock(paths, () => undefined)).not.toThrow()
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('cleans a manifest-less transaction residue instead of wedging all state commands', async () => {
    const temp = project()
    temp.mkdir('.state/transactions/11111111-1111-4111-8111-111111111111/backups/src')
    writeFileSync(
      join(temp.root, '.state/.i18n-hunter-state.json'),
      JSON.stringify({ schemaVersion: 1, projectRootHash: hashText(temp.root) }),
      'utf8',
    )

    const result = await cleanTransactions({ basePath: temp.root, stateDir: '.state' })

    expect(result.removedTransactions).toBe(1)
    expect(existsSync(join(temp.root, '.state/transactions'))).toBe(false)
  })

  it('cleans a version-skewed manifest instead of permanently wedging the state directory', async () => {
    const temp = project()
    const transactionId = '22222222-2222-4222-8222-222222222222'
    temp.mkdir(`.state/transactions/${transactionId}/backups/src`)
    writeFileSync(
      join(temp.root, '.state/.i18n-hunter-state.json'),
      JSON.stringify({ schemaVersion: 1, projectRootHash: hashText(temp.root) }),
      'utf8',
    )
    // A manifest from a different schema version must not be unreadable forever.
    writeFileSync(
      join(temp.root, `.state/transactions/${transactionId}/manifest.json`),
      JSON.stringify({ schemaVersion: 99, projectRootHash: hashText(temp.root) }),
      'utf8',
    )

    const result = await cleanTransactions({ basePath: temp.root, stateDir: '.state' })

    expect(result.removedTransactions).toBe(1)
    expect(existsSync(join(temp.root, '.state/transactions'))).toBe(false)
  })

  it('rejects manifest paths that escape the transaction directory', async () => {
    const temp = project()
    const victim = temp.write('victim.ts', 'export const victim = "safe"')
    const stateDir = temp.mkdir('.state/transactions/11111111-1111-4111-8111-111111111111')
    writeFileSync(
      join(temp.root, '.state/.i18n-hunter-state.json'),
      JSON.stringify({ schemaVersion: 1, projectRootHash: hashText(temp.root) }),
      'utf8',
    )
    writeFileSync(
      join(temp.root, '.state/latest.json'),
      JSON.stringify({ schemaVersion: 2, transactionId: '11111111-1111-4111-8111-111111111111' }),
      'utf8',
    )
    writeFileSync(
      join(stateDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        transactionId: '11111111-1111-4111-8111-111111111111',
        state: 'applied',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRootHash: 'a'.repeat(64),
        reportHash: 'b'.repeat(64),
        parentTransactionId: null,
        entries: [
          {
            filePath: 'victim.ts',
            backupPath: '../../../../outside.txt',
            beforeHash: 'c'.repeat(64),
            afterHash: 'd'.repeat(64),
            mode: 0o644,
          },
        ],
      }),
      'utf8',
    )

    await expect(rollbackTransactions({ basePath: temp.root, stateDir: '.state' })).rejects.toThrow(
      /manifest|path/i,
    )
    expect(readFileSync(victim, 'utf8')).toContain('safe')
  })

  it('rejects malformed manifests at the schema boundary', () => {
    expect(() => parseManifest({ schemaVersion: 1 })).toThrow(/manifest/i)
    expect(() =>
      parseManifest({
        schemaVersion: 2,
        transactionId: '11111111-1111-4111-8111-111111111111',
        state: 'prepared',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRootHash: 'a'.repeat(64),
        reportHash: 'b'.repeat(64),
        parentTransactionId: null,
        entries: [
          {
            filePath: 'src/App.tsx',
            backupPath: 'backups/src/Other.tsx',
            beforeHash: 'c'.repeat(64),
            afterHash: 'd'.repeat(64),
            mode: 0o644,
          },
        ],
      }),
    ).toThrow(/backup|manifest/i)
  })

  it('atomically replaces files with restrictive permissions', () => {
    const temp = project()
    const path = temp.write('state.txt', 'old')
    atomicWriteFile(path, 'new', 0o600)
    expect(readFileSync(path, 'utf8')).toBe('new')
  })

  it('releases locks even when operations throw', () => {
    const temp = project()
    const paths = resolveStatePaths(temp.root, '.state')
    expect(() =>
      withStateLock(paths, () => {
        throw new Error('operation failed')
      }),
    ).toThrow(/operation failed/)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('sweeps stale lock staging files on acquire', () => {
    const temp = project()
    const paths = resolveStatePaths(temp.root, '.state')
    temp.mkdir('.state')
    const stale = join(temp.root, '.state', '.lock-999999-1-abcdef.tmp')
    writeFileSync(stale, 'stale staging', 'utf8')
    expect(() => withStateLock(paths, () => undefined)).not.toThrow()
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('rejects manifests with world-writable/executable modes', () => {
    const base = {
      schemaVersion: 2 as const,
      transactionId: '11111111-1111-4111-8111-111111111111',
      state: 'applied' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRootHash: 'a'.repeat(64),
      reportHash: 'b'.repeat(64),
      parentTransactionId: null,
      entries: [
        {
          filePath: 'src/App.tsx',
          backupPath: 'backups/src/App.tsx',
          beforeHash: 'c'.repeat(64),
          afterHash: 'd'.repeat(64),
          mode: 0o777,
        },
      ],
    }
    expect(() => parseManifest(base)).toThrow(/manifest|mode|777|0o755/i)
    // Legitimate restrictive modes still pass the schema.
    expect(() =>
      parseManifest({ ...base, entries: [{ ...base.entries[0]!, mode: 0o644 }] }),
    ).not.toThrow()
  })

  it('never restores world-writable or executable file modes', () => {
    expect(sanitizeFileMode(0o777)).toBe(0o644)
    expect(sanitizeFileMode(0o755)).toBe(0o644)
    expect(sanitizeFileMode(0o644)).toBe(0o644)
    expect(sanitizeFileMode(0o600)).toBe(0o600)
    expect(sanitizeFileMode(0o640)).toBe(0o640)
    // Windows ACLs cannot represent POSIX modes (stat always reports 0o666/0o444).
    if (process.platform === 'win32') return
    const temp = project()
    const target = temp.write('mode.txt', 'old')
    atomicWriteFile(target, 'new', 0o777)
    const restored = statSync(target).mode & 0o777
    expect(restored & 0o002).toBe(0)
    expect(restored & 0o111).toBe(0)
    expect(restored).toBe(0o644)
  })

  it('rejects async callbacks in withStateLock and releases the lock', () => {
    const temp = project()
    const paths = resolveStatePaths(temp.root, '.state')
    expect(() =>
      withStateLock(paths, (() => Promise.resolve('leaked')) as unknown as () => string),
    ).toThrow(/synchronous/i)
    expect(existsSync(paths.lock)).toBe(false)
    expect(() =>
      withStateLock(paths, (() => ({ then: () => undefined })) as unknown as () => string),
    ).toThrow(/synchronous/i)
    expect(existsSync(paths.lock)).toBe(false)
  })
})

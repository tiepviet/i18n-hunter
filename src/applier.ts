import { createTwoFilesPatch } from 'diff'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, rmdirSync } from 'node:fs'
import { atomicWriteFile, sanitizeFileMode } from './atomic-write.js'
import { resolveStateRelativePath } from './discovery.js'
import { HunterError, errorMessage } from './errors.js'
import { scanLimitCeilings } from './limits.js'
import type { Manifest } from './manifest-schema.js'
import { canonicalizeRoot, resolveContainedSourcePath } from './path-policy.js'
import { parseExtractionReport } from './report-schema.js'
import { readJsonBounded } from './safe-json.js'
import { readTextFileBounded } from './bounded-read.js'
import { hashText } from './source-range.js'
import {
  assertOwnedState,
  backupRelativePath,
  ensureStateRoot,
  listTransactionIds,
  manifestPath,
  readLatest,
  readManifest,
  removeLatest,
  removeTransaction,
  removeTransactionResidue,
  resolveBackupPath,
  resolveStatePaths,
  transactionDirectory,
  withStateLock,
  writeLatest,
  writeManifest,
  type StatePaths,
} from './transaction-store.js'
import { createFileTransformPlan, type TransformPlan } from './transform.js'
import type { Diagnostic, ExtractionReport, ScanResult } from './types.js'

export interface ApplyTestHooks {
  beforeWrite?(filePath: string, index: number): void
}

export interface ApplyOptions {
  basePath: string
  stateDir: string
  dryRun?: boolean
  /** @internal Deterministic fault injection for integration tests. */
  testHooks?: ApplyTestHooks
}

export interface ApplyResult {
  modifiedFiles: string[]
  skipped: string[]
  diffs: string[]
  diagnostics: Diagnostic[]
  manifestPath?: string
  transactionId?: string
}

export interface RollbackResult {
  restoredFiles: string[]
  transactionIds: string[]
}

export interface CleanResult {
  removedTransactions: number
}

export async function applyReport(reportPath: string, options: ApplyOptions): Promise<ApplyResult> {
  const report = parseReport(reportPath)
  if (
    !report.complete ||
    report.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  ) {
    throw new HunterError('E_SCAN_INCOMPLETE', 'Cannot apply an incomplete scan report')
  }

  const baseRoot = canonicalizeRoot(options.basePath)
  const statePaths = resolveStatePaths(baseRoot, options.stateDir)
  const stateRelativePath = resolveStateRelativePath(baseRoot, options.stateDir)
  const grouped = groupFindings(report.findings)
  // Never trust report-declared limits for resource exhaustion: cap by local ceilings.
  const effectiveLimits = {
    maxFileBytes: Math.min(report.scan.limits.maxFileBytes, scanLimitCeilings.maxFileBytes),
    maxTotalBytes: Math.min(report.scan.limits.maxTotalBytes, scanLimitCeilings.maxTotalBytes),
    maxFiles: Math.min(report.scan.limits.maxFiles, scanLimitCeilings.maxFiles),
    maxFindings: Math.min(report.scan.limits.maxFindings, scanLimitCeilings.maxFindings),
  }
  if (
    grouped.size > effectiveLimits.maxFiles ||
    report.findings.length > effectiveLimits.maxFindings
  ) {
    throw new HunterError('E_FILE_LIMIT', 'Report exceeds its declared scan limits')
  }
  let totalBytes = 0
  const preflight: Array<{
    filePath: string
    originalContent: string
    plan: TransformPlan
    mode: number
  }> = []

  for (const [filePath, findings] of grouped) {
    // Case-insensitive on all platforms: `STATE` must not bypass the managed-state guard.
    if (
      stateRelativePath &&
      (filePath.toLowerCase() === stateRelativePath.toLowerCase() ||
        filePath.toLowerCase().startsWith(`${stateRelativePath.toLowerCase()}/`))
    ) {
      throw new HunterError(
        'E_PATH_OUTSIDE_ROOT',
        'Managed transaction state is not an apply target',
        filePath,
      )
    }
    const source = resolveContainedSourcePath(baseRoot, filePath)
    const content = readTextFileBounded(source.path, effectiveLimits.maxFileBytes)
    totalBytes += Buffer.byteLength(content, 'utf8')
    if (totalBytes > effectiveLimits.maxTotalBytes) {
      throw new HunterError('E_FILE_LIMIT', 'Report source bytes exceed maxTotalBytes')
    }
    const plan = await createFileTransformPlan(content, filePath, findings)
    if (!plan.changed) continue
    let mode: number
    try {
      const stats = lstatSync(source.path)
      if (stats.isSymbolicLink()) {
        throw new HunterError('E_SYMLINK_REJECTED', 'Source path is a symlink', filePath)
      }
      // Sanitize at capture so manifests never store world-writable/executable
      // bits observed on disk (e.g. a pre-existing 0o777 source file).
      mode = sanitizeFileMode(stats.mode & 0o777)
    } catch (error) {
      if (error instanceof HunterError) throw error
      throw new HunterError('E_IO', 'Unable to inspect source file', filePath)
    }
    preflight.push({
      filePath,
      originalContent: content,
      plan,
      mode,
    })
  }

  if (preflight.length === 0) {
    return { modifiedFiles: [], skipped: [...grouped.keys()], diffs: [], diagnostics: [] }
  }

  const diffs = preflight.map(({ filePath, originalContent, plan }) =>
    createTwoFilesPatch(filePath, filePath, originalContent, plan.content, '', '', {
      context: 3,
    }).replace(
      `--- ${filePath}\n+++ ${filePath}\n`,
      () => `--- a/${filePath}\n+++ b/${filePath}\n`,
    ),
  )

  if (options.dryRun) {
    return {
      modifiedFiles: preflight.map((item) => item.filePath),
      skipped: [],
      diffs,
      diagnostics: [],
    }
  }

  ensureStateRoot(statePaths, baseRoot)
  return withStateLock(statePaths, () =>
    commitTransaction(baseRoot, reportPath, report, preflight, statePaths, options.testHooks),
  )
}

export async function rollbackTransactions(options: {
  basePath: string
  stateDir: string
}): Promise<RollbackResult> {
  const baseRoot = canonicalizeRoot(options.basePath)
  const statePaths = resolveStatePaths(baseRoot, options.stateDir)
  assertOwnedState(statePaths, baseRoot)
  return withStateLock(statePaths, () => {
    const latest = readLatest(statePaths)
    const transactionIds = listTransactionIds(statePaths)
    if (!latest && transactionIds.length > 0) {
      throw new HunterError(
        'E_ROLLBACK_FAILED',
        'No active transaction, but orphaned state exists. Run `clean --yes` if all orphaned transactions are rolled back or prepared residue; otherwise manual recovery is required (see `clean` error details).',
      )
    }
    if (!latest) throw new HunterError('E_ROLLBACK_FAILED', 'No active transaction to roll back')

    const chain = loadTransactionChain(statePaths, latest.transactionId, baseRoot)
    const expectedCurrent = new Map<string, string>()
    // Limit-less legacy manifests fall back to the ceiling, not the 2 MB
    // default, so large-file chains do not wedge rollback.
    const limitOf = (manifest: Manifest): number =>
      manifest.limits?.maxFileBytes ?? scanLimitCeilings.maxFileBytes
    for (const item of chain) {
      for (const entry of item.manifest.entries) {
        const source = resolveContainedSourcePath(baseRoot, entry.filePath)
        const actual = expectedCurrent.has(entry.filePath)
          ? expectedCurrent.get(entry.filePath)!
          : hashText(readTextFileBounded(source.path, limitOf(item.manifest)))
        const validCurrentState = actual === entry.afterHash || actual === entry.beforeHash
        if (!validCurrentState) {
          throw new HunterError(
            'E_ROLLBACK_FAILED',
            `Source changed after apply: ${entry.filePath}`,
            entry.filePath,
          )
        }
        expectedCurrent.set(entry.filePath, entry.beforeHash)
        const backup = resolveBackupPath(
          transactionDirectory(statePaths, item.manifest.transactionId),
          entry.backupPath,
        )
        if (
          !existsSync(backup) ||
          hashText(readTextFileBounded(backup, limitOf(item.manifest))) !== entry.beforeHash
        ) {
          throw new HunterError(
            'E_ROLLBACK_FAILED',
            `Backup is missing or corrupt: ${entry.filePath}`,
            entry.filePath,
          )
        }
      }
    }

    const restored = new Set<string>()
    for (const { manifest } of chain) {
      if (manifest.state !== 'rolled_back') {
        writeManifest(statePaths, {
          ...manifest,
          state: 'rolling_back',
          updatedAt: new Date().toISOString(),
        })
      }
      const transactionRoot = transactionDirectory(statePaths, manifest.transactionId)
      const limit = manifest.limits?.maxFileBytes ?? scanLimitCeilings.maxFileBytes
      for (const entry of manifest.entries) {
        const source = resolveContainedSourcePath(baseRoot, entry.filePath)
        const backup = resolveBackupPath(transactionRoot, entry.backupPath)
        const backupContent = readTextFileBounded(backup, limit)
        if (hashText(backupContent) !== entry.beforeHash) {
          throw new HunterError(
            'E_ROLLBACK_FAILED',
            `Backup is missing or corrupt: ${entry.filePath}`,
            entry.filePath,
          )
        }
        const currentHash = hashText(readTextFileBounded(source.path, limit))
        if (currentHash !== entry.beforeHash) {
          if (currentHash !== entry.afterHash) {
            throw new HunterError(
              'E_ROLLBACK_FAILED',
              `Source changed during rollback: ${entry.filePath}`,
              entry.filePath,
            )
          }
          const verifiedSource = resolveContainedSourcePath(baseRoot, entry.filePath)
          atomicWriteFile(verifiedSource.path, backupContent, sanitizeFileMode(entry.mode))
        }
        if (hashText(readTextFileBounded(source.path, limit)) !== entry.beforeHash) {
          throw new HunterError(
            'E_ROLLBACK_FAILED',
            `Rollback verification failed: ${entry.filePath}`,
            entry.filePath,
          )
        }
        restored.add(entry.filePath)
      }
      writeManifest(statePaths, {
        ...manifest,
        state: 'rolled_back',
        updatedAt: new Date().toISOString(),
      })
    }
    removeLatest(statePaths)
    return {
      restoredFiles: [...restored].sort(),
      transactionIds: chain.map((item) => item.manifest.transactionId),
    }
  })
}

export async function cleanTransactions(options: {
  basePath: string
  stateDir: string
  all?: boolean
}): Promise<CleanResult> {
  const baseRoot = canonicalizeRoot(options.basePath)
  const statePaths = resolveStatePaths(baseRoot, options.stateDir)
  if (options.all) {
    throw new HunterError(
      'E_CLEAN_FAILED',
      'Force clean is not supported; roll back active state first',
    )
  }
  assertOwnedState(statePaths, baseRoot)
  return withStateLock(statePaths, () => {
    const latest = readLatest(statePaths)
    const transactionIds = listTransactionIds(statePaths)
    if (latest) {
      throw new HunterError('E_CLEAN_FAILED', 'Active transaction must be rolled back before clean')
    }
    for (const transactionId of transactionIds) {
      let manifest: Manifest
      try {
        manifest = readManifest(statePaths, transactionId)
      } catch (error) {
        // With no latest pointer, no source file was ever written by this tool
        // (the pointer is promoted before the first write), so an unreadable
        // manifest cannot represent recoverable work. Treat it as residue rather
        // than wedging every future command on a version-skewed manifest.
        if (
          error instanceof HunterError &&
          (error.code === 'E_JSON_INVALID' ||
            error.code === 'E_JSON_TOO_LARGE' ||
            error.code === 'E_MANIFEST_SCHEMA')
        ) {
          removeTransactionResidue(statePaths, transactionId)
          continue
        }
        throw new HunterError(
          'E_CLEAN_FAILED',
          `Transaction manifest is unreadable: ${transactionId}`,
          transactionId,
        )
      }
      if (manifest.projectRootHash !== hashText(baseRoot)) {
        throw new HunterError(
          'E_CLEAN_FAILED',
          'Transaction belongs to another project',
          transactionId,
        )
      }
      if (manifest.state === 'rolled_back' || manifest.state === 'prepared') {
        if (manifest.state === 'rolled_back') removeTransaction(statePaths, transactionId)
        else removeTransactionResidue(statePaths, transactionId)
        continue
      }
      throw new HunterError(
        'E_CLEAN_FAILED',
        `Transaction state requires manual recovery: ${manifest.state} (${transactionId}). Roll back first, or remove the state directory manually if the chain is unrecoverable: ${statePaths.root}`,
        transactionId,
      )
    }
    if (existsSync(statePaths.transactions)) {
      try {
        rmdirSync(statePaths.transactions)
      } catch (error) {
        throw new HunterError(
          'E_CLEAN_FAILED',
          `Unable to remove empty transactions directory: ${(error as Error).message}`,
        )
      }
    }
    removeLatest(statePaths)
    return { removedTransactions: transactionIds.length }
  })
}

function commitTransaction(
  baseRoot: string,
  reportPath: string,
  report: ExtractionReport,
  preflight: Array<{
    filePath: string
    originalContent: string
    plan: TransformPlan
    mode: number
  }>,
  statePaths: StatePaths,
  testHooks?: ApplyTestHooks,
): ApplyResult {
  const transactionId = randomUUID()
  const transactionRoot = transactionDirectory(statePaths, transactionId)
  const parent = readLatest(statePaths)
  const existingTransactionIds = listTransactionIds(statePaths)
  if (!parent && existingTransactionIds.length > 0) {
    throw new HunterError(
      'E_TRANSACTION_CONFLICT',
      'Orphaned transaction state exists. Run `clean --yes` or `rollback` before applying again.',
    )
  }
  let parentId: string | null = null
  if (parent) {
    if (!existingTransactionIds.includes(parent.transactionId)) {
      throw new HunterError(
        'E_TRANSACTION_CONFLICT',
        'Latest transaction pointer is not owned by state',
      )
    }
    validateAppliedParentChain(baseRoot, statePaths, parent.transactionId)
    parentId = parent.transactionId
  }

  mkdirSync(transactionRoot, { recursive: true, mode: 0o700 })
  const now = new Date().toISOString()
  const manifest: Manifest = {
    schemaVersion: 2,
    transactionId,
    state: 'prepared',
    createdAt: now,
    updatedAt: now,
    projectRootHash: hashText(baseRoot),
    reportHash: hashText(readTextFileBounded(reportPath, 20_000_000)),
    parentTransactionId: parentId,
    limits: { ...report.scan.limits },
    entries: [],
  }
  const written: Array<{
    filePath: string
    backupPath: string
    mode: number
    originalHash: string
    finalHash: string
  }> = []
  let latestPromoted = false
  writeManifest(statePaths, manifest)

  try {
    for (const item of preflight) {
      const source = resolveContainedSourcePath(baseRoot, item.filePath)
      const backupRelative = backupRelativePath(item.filePath)
      const backup = resolveBackupPath(transactionRoot, backupRelative, true)
      // Backups contain complete source files: always restrictive, never source mode.
      atomicWriteFile(backup, readTextFileBounded(source.path, 10_000_000), 0o600)
      if (hashText(readTextFileBounded(backup, 10_000_000)) !== item.plan.originalHash) {
        throw new HunterError(
          'E_APPLY_FAILED',
          `Backup verification failed: ${item.filePath}`,
          item.filePath,
        )
      }
      manifest.entries.push({
        filePath: item.filePath,
        backupPath: backupRelative,
        beforeHash: item.plan.originalHash,
        afterHash: item.plan.finalHash,
        mode: sanitizeFileMode(item.mode),
      })
      writeManifest(statePaths, manifest)
    }
    writeManifest(statePaths, manifest)
    writeLatest(statePaths, transactionId)
    latestPromoted = true

    for (const [index, item] of preflight.entries()) {
      const source = resolveContainedSourcePath(baseRoot, item.filePath)
      if (hashText(readTextFileBounded(source.path, 10_000_000)) !== item.plan.originalHash) {
        throw new HunterError(
          'E_STALE_SOURCE',
          `Source changed during apply: ${item.filePath}`,
          item.filePath,
        )
      }
      testHooks?.beforeWrite?.(item.filePath, index)
      const verifiedSource = resolveContainedSourcePath(baseRoot, item.filePath)
      written.push({
        filePath: item.filePath,
        backupPath: backupRelativePath(item.filePath),
        mode: sanitizeFileMode(item.mode),
        originalHash: item.plan.originalHash,
        finalHash: item.plan.finalHash,
      })
      atomicWriteFile(verifiedSource.path, item.plan.content, sanitizeFileMode(item.mode))
      if (hashText(readTextFileBounded(verifiedSource.path, 10_000_000)) !== item.plan.finalHash) {
        throw new HunterError(
          'E_APPLY_FAILED',
          `Write verification failed: ${item.filePath}`,
          item.filePath,
        )
      }
    }

    const appliedManifest: Manifest = {
      ...manifest,
      state: 'applied',
      updatedAt: new Date().toISOString(),
    }
    writeManifest(statePaths, appliedManifest)
    writeLatest(statePaths, transactionId)
    return {
      modifiedFiles: preflight.map((item) => item.filePath),
      skipped: [],
      diffs: [],
      diagnostics: [],
      manifestPath: manifestPath(statePaths, transactionId),
      transactionId,
    }
  } catch (error) {
    let rollbackSucceeded = true
    let rollbackCause: unknown
    for (const item of [...written].reverse()) {
      try {
        const source = resolveContainedSourcePath(baseRoot, item.filePath)
        const backup = resolveBackupPath(transactionRoot, item.backupPath)
        const backupContent = readTextFileBounded(backup, 10_000_000)
        const backupHash = hashText(backupContent)
        // Verify the backup BEFORE overwriting the source: a corrupt backup must
        // never clobber good source content.
        if (backupHash !== item.originalHash) {
          rollbackSucceeded = false
          rollbackCause ??= new Error(`Automatic restore found a corrupt backup: ${item.filePath}`)
          continue
        }
        const currentHash = hashText(readTextFileBounded(source.path, 10_000_000))
        if (currentHash !== item.originalHash && currentHash !== item.finalHash) {
          rollbackSucceeded = false
          rollbackCause ??= new Error(`Source changed during automatic rollback: ${item.filePath}`)
          continue
        }
        if (currentHash !== item.originalHash)
          atomicWriteFile(source.path, backupContent, sanitizeFileMode(item.mode))
        if (hashText(readTextFileBounded(source.path, 10_000_000)) !== item.originalHash) {
          rollbackSucceeded = false
          rollbackCause ??= new Error(`Automatic restore verification failed: ${item.filePath}`)
        }
      } catch (restoreError) {
        rollbackSucceeded = false
        rollbackCause ??= restoreError
      }
    }
    writeManifest(statePaths, {
      ...manifest,
      state: rollbackSucceeded ? 'rolled_back' : 'rollback_failed',
      updatedAt: new Date().toISOString(),
    })
    if (latestPromoted && rollbackSucceeded) {
      if (parentId) writeLatest(statePaths, parentId)
      else removeLatest(statePaths)
    }
    const failureReason = rollbackSucceeded ? error : (rollbackCause ?? error)
    throw new HunterError(
      'E_APPLY_FAILED',
      `Apply failed and was ${rollbackSucceeded ? 'rolled back' : 'left for recovery'}: ${errorMessage(failureReason)}`,
    )
  }
}

function validateAppliedParentChain(
  baseRoot: string,
  statePaths: StatePaths,
  transactionId: string,
): void {
  const seen = new Set<string>()
  let current: string | null = transactionId
  while (current) {
    if (seen.has(current))
      throw new HunterError('E_MANIFEST_SCHEMA', 'Transaction parent chain contains a cycle')
    seen.add(current)
    const manifest = readManifest(statePaths, current)
    if (manifest.state !== 'applied' || manifest.projectRootHash !== hashText(baseRoot)) {
      throw new HunterError(
        'E_TRANSACTION_CONFLICT',
        'Parent transaction is not recoverable applied state',
      )
    }
    for (const entry of manifest.entries) {
      const source = resolveContainedSourcePath(baseRoot, entry.filePath)
      const limit = manifest.limits?.maxFileBytes ?? scanLimitCeilings.maxFileBytes
      if (hashText(readTextFileBounded(source.path, limit)) !== entry.afterHash) {
        throw new HunterError(
          'E_STALE_SOURCE',
          `Parent source changed: ${entry.filePath}`,
          entry.filePath,
        )
      }
      const backup = resolveBackupPath(transactionDirectory(statePaths, current), entry.backupPath)
      if (
        !existsSync(backup) ||
        hashText(readTextFileBounded(backup, limit)) !== entry.beforeHash
      ) {
        throw new HunterError(
          'E_ROLLBACK_FAILED',
          `Parent backup is missing or corrupt: ${entry.filePath}`,
          entry.filePath,
        )
      }
    }
    current = manifest.parentTransactionId
  }
}

function loadTransactionChain(
  statePaths: StatePaths,
  transactionId: string,
  baseRoot: string,
): Array<{ manifest: Manifest }> {
  const chain: Array<{ manifest: Manifest }> = []
  const seen = new Set<string>()
  let current: string | null = transactionId
  while (current) {
    if (seen.has(current))
      throw new HunterError('E_MANIFEST_SCHEMA', 'Transaction chain contains a cycle')
    seen.add(current)
    const manifest = readManifest(statePaths, current)
    if (manifest.transactionId !== current || manifest.projectRootHash !== hashText(baseRoot)) {
      throw new HunterError(
        'E_MANIFEST_SCHEMA',
        'Transaction manifest does not belong to this project',
      )
    }
    if (
      !['applied', 'prepared', 'rolling_back', 'rolled_back', 'rollback_failed'].includes(
        manifest.state,
      )
    ) {
      throw new HunterError('E_ROLLBACK_FAILED', `Transaction is not active: ${current}`)
    }
    chain.push({ manifest })
    current = manifest.parentTransactionId
  }
  return chain
}

function parseReport(reportPath: string): ExtractionReport {
  // Single 20 MB cap shared with the manifest `reportHash` read below, so a
  // large-but-schema-valid report fails consistently instead of passing parse
  // then failing at fingerprint time. A same-user swap between the two reads
  // remains out of scope (see security-model).
  return parseExtractionReport(readJsonBounded(reportPath, 20_000_000))
}

function groupFindings(findings: ScanResult[]): Map<string, ScanResult[]> {
  const grouped = new Map<string, ScanResult[]>()
  for (const finding of findings) {
    const group = grouped.get(finding.filePath) ?? []
    group.push(finding)
    grouped.set(finding.filePath, group)
  }
  return grouped
}

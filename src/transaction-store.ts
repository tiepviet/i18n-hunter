import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from './atomic-write.js'
import { HunterError } from './errors.js'
import {
  parseLatestTransaction,
  parseManifest,
  type LatestTransaction,
  type Manifest,
} from './manifest-schema.js'
import { resolveContainedPath } from './path-policy.js'
import { readJsonBounded } from './safe-json.js'
import { hashText } from './source-range.js'

const stateMarkerName = '.i18n-hunter-state.json'
const transactionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

interface StateMarker {
  schemaVersion: 1
  projectRootHash: string
}

interface LockRecord {
  pid: number
  token: string
  startedAt: string
  hostname: string
}

export interface StatePaths {
  root: string
  transactions: string
  latest: string
  lock: string
  marker: string
}

export function resolveStatePaths(basePath: string, stateDir: string): StatePaths {
  const baseRoot = resolve(basePath)
  const absolute = isAbsolute(stateDir) ? resolve(stateDir) : resolve(baseRoot, stateDir)
  if (absolute === baseRoot || absolute === resolve(baseRoot, '.')) {
    throw new HunterError(
      'E_INVALID_INPUT',
      'State directory must be a dedicated child or external directory',
    )
  }
  assertNoSymlink(absolute, stateDir)
  return {
    root: absolute,
    transactions: join(absolute, 'transactions'),
    latest: join(absolute, 'latest.json'),
    lock: join(absolute, 'lock'),
    marker: join(absolute, stateMarkerName),
  }
}

export function ensureStateRoot(paths: StatePaths, baseRoot: string): void {
  if (existsSync(paths.root)) {
    const rootStats = lstatSync(paths.root)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new HunterError('E_SYMLINK_REJECTED', 'State root must be a real directory', paths.root)
    }
    if (existsSync(paths.marker)) {
      assertMarker(paths, baseRoot)
    } else {
      assertManagedChildren(paths)
      const entries = readdirSync(paths.root)
      if (entries.length > 0) {
        throw new HunterError(
          'E_INVALID_INPUT',
          'Refusing to claim a non-empty unowned state directory',
        )
      }
    }
  } else {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  }

  if (!existsSync(paths.marker)) {
    atomicWriteFile(
      paths.marker,
      `${JSON.stringify({ schemaVersion: 1, projectRootHash: hashText(resolve(baseRoot)) })}\n`,
      0o600,
    )
  }
  assertMarker(paths, baseRoot)
  hardenDirectory(paths.root)
  assertManagedChildren(paths)
}

export function assertOwnedState(paths: StatePaths, baseRoot: string): void {
  if (!existsSync(paths.root) || !existsSync(paths.marker)) {
    throw new HunterError('E_INVALID_INPUT', 'State directory is not owned by i18n-hunter')
  }
  assertMarker(paths, baseRoot)
  hardenDirectory(paths.root)
  assertManagedChildren(paths)
}

/**
 * Run a synchronous critical section under the exclusive state lock.
 *
 * The callback MUST be synchronous. An async (Promise-returning) callback
 * would release the lock before the Promise settles, breaking mutual
 * exclusion. Promise-returning callbacks are rejected with E_INVALID_INPUT.
 */
export function withStateLock<T>(paths: StatePaths, operation: () => T): T {
  if (!existsSync(paths.root)) mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  assertManagedChildren(paths)
  const token = `${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}`
  acquireLock(paths, token)
  try {
    const result = operation()
    if (
      result instanceof Promise ||
      typeof (result as unknown as { then?: unknown } | null | undefined)?.then === 'function'
    ) {
      // Avoid an unhandled rejection from the orphaned promise.
      try {
        ;(result as unknown as Promise<unknown>).catch(() => undefined)
      } catch {
        // Non-Promise thenables may not have .catch; ignoring is safe.
      }
      throw new HunterError(
        'E_INVALID_INPUT',
        'withStateLock requires a synchronous operation; use an async variant for Promise-returning callbacks',
      )
    }
    return result
  } finally {
    releaseLock(paths, token)
  }
}

export function transactionDirectory(paths: StatePaths, transactionId: string): string {
  if (!transactionIdPattern.test(transactionId)) {
    throw new HunterError('E_MANIFEST_SCHEMA', 'Invalid transaction id')
  }
  const directory = join(paths.transactions, transactionId)
  assertManagedChildren(paths)
  if (existsSync(directory)) {
    const stats = lstatSync(directory)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new HunterError(
        'E_SYMLINK_REJECTED',
        'Transaction directory must be a real directory',
        directory,
      )
    }
    const canonical = realpathSync.native(directory)
    if (!isInside(paths.transactions, canonical)) {
      throw new HunterError('E_MANIFEST_SCHEMA', 'Transaction directory escapes state root')
    }
  }
  return directory
}

export function manifestPath(paths: StatePaths, transactionId: string): string {
  return join(transactionDirectory(paths, transactionId), 'manifest.json')
}

export function readManifest(paths: StatePaths, transactionId: string): Manifest {
  return parseManifest(readJsonBounded(manifestPath(paths, transactionId)))
}

export function writeManifest(paths: StatePaths, manifest: Manifest): void {
  atomicWriteFile(
    manifestPath(paths, manifest.transactionId),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o600,
  )
}

export function readLatest(paths: StatePaths): LatestTransaction | undefined {
  if (!existsSync(paths.latest)) return undefined
  return parseLatestTransaction(readJsonBounded(paths.latest))
}

export function writeLatest(paths: StatePaths, transactionId: string): void {
  assertManagedChildren(paths)
  atomicWriteFile(
    paths.latest,
    `${JSON.stringify({ schemaVersion: 2, transactionId }, null, 2)}\n`,
    0o600,
  )
}

export function removeLatest(paths: StatePaths): void {
  try {
    unlinkSync(paths.latest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function backupRelativePath(filePath: string): string {
  return `backups/${filePath}`
}

export function resolveBackupPath(
  transactionRoot: string,
  backupPath: string,
  allowMissing = false,
): string {
  if (
    backupPath !== `backups/${backupPath.slice('backups/'.length)}` ||
    !backupPath.startsWith('backups/')
  ) {
    throw new HunterError('E_MANIFEST_SCHEMA', 'Backup path is not a managed backup path')
  }
  const resolved = resolveContainedPath(transactionRoot, backupPath, { allowMissing })
  return resolved.path
}

export function listTransactionIds(paths: StatePaths): string[] {
  if (!existsSync(paths.transactions)) return []
  assertManagedChildren(paths)
  const ids: string[] = []
  for (const entry of readdirSync(paths.transactions, { withFileTypes: true })) {
    const full = join(paths.transactions, entry.name)
    if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) {
      throw new HunterError('E_SYMLINK_REJECTED', 'Transaction entries may not be symlinks', full)
    }
    if (!entry.isDirectory()) continue
    if (!transactionIdPattern.test(entry.name)) continue
    ids.push(entry.name)
  }
  return ids
}

export function removeTransaction(paths: StatePaths, transactionId: string): void {
  const directory = transactionDirectory(paths, transactionId)
  if (!existsSync(directory)) return
  const manifest = readManifest(paths, transactionId)
  for (const entry of manifest.entries) {
    const backup = resolveBackupPath(directory, entry.backupPath)
    try {
      unlinkSync(backup)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new HunterError(
          'E_CLEAN_FAILED',
          `Unable to remove transaction backup: ${entry.backupPath}`,
          transactionId,
        )
      }
    }
  }
  try {
    unlinkSync(manifestPath(paths, transactionId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new HunterError(
        'E_CLEAN_FAILED',
        'Unable to remove transaction manifest',
        transactionId,
      )
    }
  }
  // Remove known backup parents best-effort, then anything left (e.g. attacker-
  // planted extra files) via a bounded recursive remove so `clean` cannot wedge.
  for (const backupDirectory of knownBackupParents(directory, manifest)) {
    removeEmptyParents(backupDirectory, directory)
  }
  try {
    rmdirSync(directory)
  } catch {
    rmSync(directory, { recursive: true, force: false })
  }
  removeEmptyParents(dirname(directory), paths.transactions)
}

function knownBackupParents(directory: string, manifest: Manifest): string[] {
  const directories = new Set<string>()
  for (const entry of manifest.entries) {
    try {
      directories.add(dirname(resolveBackupPath(directory, entry.backupPath)))
    } catch {
      // Ignore unresolvable entries here; recursive fallback below still cleans.
    }
  }
  return [...directories].sort((left, right) => right.length - left.length)
}

export function removeTransactionResidue(paths: StatePaths, transactionId: string): void {
  const directory = transactionDirectory(paths, transactionId)
  if (!existsSync(directory)) return
  const canonical = realpathSync.native(directory)
  if (!isInside(paths.transactions, canonical)) {
    throw new HunterError('E_MANIFEST_SCHEMA', 'Transaction residue escapes state root')
  }
  try {
    rmSync(directory, { recursive: true, force: false })
  } catch (error) {
    throw new HunterError(
      'E_CLEAN_FAILED',
      `Unable to remove transaction residue: ${(error as Error).message}`,
      transactionId,
    )
  }
  removeEmptyParents(paths.transactions, paths.root)
}

function assertMarker(paths: StatePaths, baseRoot: string): void {
  const marker = readJsonBounded(paths.marker, 10_000) as Partial<StateMarker>
  if (marker.schemaVersion !== 1 || marker.projectRootHash !== hashText(resolve(baseRoot))) {
    throw new HunterError('E_INVALID_INPUT', 'State directory belongs to another project')
  }
}

function assertManagedChildren(paths: StatePaths): void {
  for (const path of [paths.transactions, paths.latest, paths.lock, paths.marker]) {
    if (!existsSync(path)) continue
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) {
      throw new HunterError('E_SYMLINK_REJECTED', 'Managed state paths may not be symlinks', path)
    }
    if (path !== paths.transactions && !stats.isFile()) {
      throw new HunterError('E_INVALID_INPUT', 'Managed state path has an invalid type', path)
    }
  }
  if (existsSync(paths.transactions)) {
    const canonicalRoot = realpathSync.native(paths.root)
    const canonicalTransactions = realpathSync.native(paths.transactions)
    if (!isInside(canonicalRoot, canonicalTransactions)) {
      throw new HunterError(
        'E_SYMLINK_REJECTED',
        'Managed transactions path escapes state root',
        paths.transactions,
      )
    }
  }
}

function acquireLock(paths: StatePaths, token: string): void {
  sweepStaleStagingFiles(paths.root, token)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temporaryPath = join(paths.root, `.lock-${token}.tmp`)
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600)
      const record: LockRecord = {
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        hostname: hostname(),
      }
      writeSync(descriptor, `${JSON.stringify(record)}\n`)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      try {
        linkSync(temporaryPath, paths.lock)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) {
          throw new HunterError(
            'E_TRANSACTION_CONFLICT',
            `Another i18n-hunter transaction is active (lock held; holder: ${describeLockHolder(paths.lock)})`,
          )
        }
        if (!isStaleLock(paths.lock)) {
          throw new HunterError(
            'E_TRANSACTION_CONFLICT',
            `Another i18n-hunter transaction is active (lock held; holder: ${describeLockHolder(paths.lock)})`,
          )
        }
        try {
          unlinkSync(paths.lock)
        } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
          // Lost the race with another contender; treat as contention.
          throw new HunterError(
            'E_TRANSACTION_CONFLICT',
            'Another i18n-hunter transaction is active',
          )
        }
        continue
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try {
        unlinkSync(temporaryPath)
      } catch {
        // Best-effort cleanup of a lock staging file.
      }
    }
  }
  throw new HunterError('E_TRANSACTION_CONFLICT', 'Another i18n-hunter transaction is active')
}

function sweepStaleStagingFiles(root: string, currentToken: string): void {
  // Crashed holders leave `.lock-<token>.tmp` droppings. Sweep only files old
  // enough that no live contender can own them (token embeds Date.now()).
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue
    const match = /^\.lock-(.+)\.tmp$/u.exec(entry.name)
    if (!match || match[1] === currentToken) continue
    const parts = match[1]!.split('-')
    const created = Number(parts[1])
    if (!Number.isSafeInteger(created) || now - created < 3_600_000) continue
    try {
      const full = join(root, entry.name)
      if (lstatSync(full).isSymbolicLink()) continue
      unlinkSync(full)
    } catch {
      // Best effort; a live contender's file is seconds old and never matches.
    }
  }
}

function describeLockHolder(path: string): string {
  try {
    if (lstatSync(path).isSymbolicLink()) return 'symlink (refused)'
    const record = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
    const pid = typeof record.pid === 'number' ? record.pid : '?'
    const host = typeof record.hostname === 'string' ? record.hostname : '?'
    const started = typeof record.startedAt === 'string' ? record.startedAt : '?'
    return `pid=${pid} host=${host} startedAt=${started}`
  } catch {
    return 'unknown'
  }
}

function releaseLock(paths: StatePaths, token: string): void {
  let record: LockRecord
  try {
    if (lstatSync(paths.lock).isSymbolicLink()) {
      throw new HunterError(
        'E_TRANSACTION_CONFLICT',
        'Transaction lock is a symlink; results are not trustworthy',
      )
    }
    record = JSON.parse(readFileSync(paths.lock, 'utf8')) as LockRecord
  } catch (error) {
    if (error instanceof HunterError) throw error
    // The lock may already have been removed by an operator-recovery step.
    return
  }
  if (record.token !== token) {
    throw new HunterError(
      'E_TRANSACTION_CONFLICT',
      'Transaction lock was stolen or replaced during the operation; results are not trustworthy',
    )
  }
  try {
    unlinkSync(paths.lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function isStaleLock(path: string): boolean {
  let record: LockRecord
  try {
    if (lstatSync(path).isSymbolicLink()) return false
    record = JSON.parse(readFileSync(path, 'utf8')) as LockRecord
  } catch {
    // Corrupt locks are NOT treated as stale: deleting them would hide evidence
    // of tampering. Require manual recovery instead.
    return false
  }
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return false
  // Cross-host locks are never considered stale: on shared filesystems two hosts
  // would otherwise both enter the critical section. Require manual recovery.
  // Locks without a hostname predate the holder-identity field; fall back to pid liveness.
  if (typeof record.hostname === 'string' && record.hostname !== hostname()) return false
  try {
    process.kill(record.pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

function hardenDirectory(path: string): void {
  if (process.platform !== 'win32') chmodSync(path, 0o700)
}

function removeEmptyParents(start: string, stop: string): void {
  let current = start
  while (current !== stop && isInside(stop, current)) {
    try {
      rmdirSync(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function assertNoSymlink(path: string, displayPath: string): void {
  let current = resolve(path)
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    throw new HunterError(
      'E_SYMLINK_REJECTED',
      'State directory paths may not be symlinks',
      displayPath,
    )
  }
  const suffix: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    suffix.unshift(current.slice(parent.length + 1))
    current = parent
  }
  const canonicalParent = realpathSync.native(current)
  let candidate = canonicalParent
  for (const segment of suffix) {
    candidate = join(candidate, segment)
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new HunterError(
        'E_SYMLINK_REJECTED',
        'State directory paths may not be symlinks',
        displayPath,
      )
    }
  }
}

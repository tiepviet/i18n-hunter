import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, basename, join } from 'node:path'
import { HunterError } from './errors.js'

/**
 * Strip dangerous permission bits from a mode restored onto a source file.
 *
 * Masks to the `0o644` subset (strips `0o022` group/other-writable and `0o111`
 * executable bits). Preserves `0o600`/`0o644`/`0o640`/`0o444`; maps `0o777`/
 * `0o755` to `0o644`. Falls back to `0o644` when sanitizing would leave the
 * file owner-unreadable (pathological modes such as `0o111`/`0o000`).
 *
 * The executable bit is intentionally stripped even when the original mode
 * legitimately carried `+x` (e.g. `0o755` restores as `0o644`): restores stay
 * fail-closed and never recreate an executable or world-writable file. A
 * caller that must preserve executability has to re-apply `chmod +x`
 * explicitly after the restore.
 */
export function sanitizeFileMode(mode: number): number {
  const sanitized = mode & 0o644
  if ((sanitized & 0o400) === 0) return 0o644
  return sanitized
}

export function atomicWriteFile(path: string, content: string, mode?: number): void {
  const directory = dirname(path)
  try {
    const existing = lstatSync(path)
    if (existing.isSymbolicLink()) {
      throw new HunterError('E_SYMLINK_REJECTED', `Refusing to replace symlink: ${path}`, path)
    }
  } catch (error) {
    if (error instanceof HunterError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${Date.now()}.${randomBytes(8).toString('hex')}.tmp`,
  )

  let descriptor: number | undefined
  try {
    // Defense-in-depth: never create a world-writable or executable file, even
    // if a caller passes through a manifest-supplied mode. Backups (0o600) and
    // typical source modes (0o644/0o640) pass through unchanged.
    const safeMode = mode === undefined ? 0o600 : sanitizeFileMode(mode)
    descriptor = openSync(temporaryPath, 'wx', safeMode)
    if (mode !== undefined) fchmodSync(descriptor, safeMode)
    const buffer = Buffer.from(content, 'utf8')
    let written = 0
    while (written < buffer.length) {
      written += writeSync(descriptor, buffer, written, buffer.length - written)
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, path)
    try {
      const directoryDescriptor = openSync(directory, 'r')
      try {
        fsyncSync(directoryDescriptor)
      } finally {
        closeSync(directoryDescriptor)
      }
    } catch (error) {
      // Directory fsync is best-effort durability: Windows refuses to open
      // directories for reading (EPERM), and macOS/Windows may report
      // EINVAL/ENOTSUP/EISDIR/EBADF. The file data itself was already fsynced.
      const code = (error as NodeJS.ErrnoException).code
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF', 'EPERM', 'EACCES'].includes(code ?? ''))
        throw error
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

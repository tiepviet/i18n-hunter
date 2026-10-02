import {
  closeSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname, basename, join } from 'node:path'

export function atomicWriteFile(path: string, content: string, mode?: number): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )

  let descriptor: number | undefined
  try {
    descriptor = openSync(temporaryPath, 'wx', mode ?? 0o600)
    if (mode !== undefined) fchmodSync(descriptor, mode)
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
      const code = (error as NodeJS.ErrnoException).code
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF'].includes(code ?? '')) throw error
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

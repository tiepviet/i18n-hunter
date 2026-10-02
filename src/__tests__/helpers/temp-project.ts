import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface TempProject {
  root: string
  write(relativePath: string, content: string): string
  mkdir(relativePath: string): string
  read(relativePath: string): string
  cleanup(): void
}

export function createTempProject(prefix = 'i18n-hunter-test-'): TempProject {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))

  return {
    root,
    write(relativePath: string, content: string): string {
      const fullPath = join(root, relativePath)
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, content, 'utf8')
      return fullPath
    },
    mkdir(relativePath: string): string {
      const fullPath = join(root, relativePath)
      mkdirSync(fullPath, { recursive: true })
      return fullPath
    },
    read(relativePath: string): string {
      return readFileSync(join(root, relativePath), 'utf8')
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { applyReport, rollbackFromManifest, cleanBackups } from '../applier.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

describe('applier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('')
  })

  it('restores files via rollback', () => {
    const manifestData = {
      entries: [{ originalPath: 'src/App.vue', backupPath: 'src/App.vue.bak' }]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifestData))
    rollbackFromManifest('manifest.json')
    expect(vi.mocked(fs.copyFileSync)).toHaveBeenCalledWith('src/App.vue.bak', 'src/App.vue')
  })

  it('injects vue-i18n import and hook', () => {
    const reportData = {
      results: [{
        filePath: 'src/App.vue', lineNumber: 1, columnNumber: 1,
        hardcodedString: 'Hello', suggestedKey: 'k', context: 'text-node'
      }]
    }
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.toString().includes('.json')) return JSON.stringify(reportData)
      if (path.toString().endsWith('App.vue')) return '<template><div>Hello</div></template>\n<script setup>\nimport { ref } from "vue"\n</script>'
      return ''
    })

    applyReport('report.json', { basePath: '/', outputDir: '/reports' })
    
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('App.vue'),
        expect.stringContaining("import { useI18n } from 'vue-i18n'"),
        'utf-8'
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('App.vue'),
        expect.stringContaining("const { t } = useI18n()"),
        'utf-8'
    )
  })

  it('replaces Vue attributes with :attribute="$t(key)"', () => {
    const reportData = {
      results: [{
        filePath: 'src/App.vue', lineNumber: 1, columnNumber: 1,
        hardcodedString: 'Search...', suggestedKey: 'search', context: 'attribute:placeholder:label'
      }]
    }
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.toString().includes('.json')) return JSON.stringify(reportData)
      if (path.toString().endsWith('App.vue')) return '<template><input placeholder="Search..." /></template>'
      return ''
    })

    applyReport('report.json', { basePath: '/', outputDir: '/reports' })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('App.vue'),
        expect.stringContaining(':placeholder="$t(\'search\')"'),
        'utf-8'
    )
  })

  it('replaces React attributes with attribute={t(key)}', () => {
    const reportData = {
      results: [{
        filePath: 'src/App.tsx', lineNumber: 1, columnNumber: 1,
        hardcodedString: 'Search...', suggestedKey: 'search', context: 'attribute:placeholder:label'
      }]
    }
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.toString().includes('.json')) return JSON.stringify(reportData)
      if (path.toString().endsWith('App.tsx')) return 'export const App = () => <input placeholder="Search..." />'
      return ''
    })

    applyReport('report.json', { basePath: '/', outputDir: '/reports' })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('App.tsx'),
        expect.stringContaining('placeholder={t(\'search\')}'),
        'utf-8'
    )
  })

  it('replaces strings in scripts for success notifications', () => {
    const reportData = {
      results: [{
        filePath: 'src/utils.ts', lineNumber: 1, columnNumber: 1,
        hardcodedString: 'Success!', suggestedKey: 'ok', context: 'notification:success'
      }]
    }
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.toString().includes('.json')) return JSON.stringify(reportData)
      if (path.toString().endsWith('utils.ts')) return 'toast.success("Success!")'
      return ''
    })

    applyReport('report.json', { basePath: '/', outputDir: '/reports' })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('utils.ts'),
        expect.stringContaining("toast.success(t('ok'))"),
        'utf-8'
    )
  })

  it('cleans up backups and manifest', () => {
    const manifestData = {
      entries: [{ originalPath: 'f', backupPath: 'f.bak' }]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifestData))
    cleanBackups('manifest.json')
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith('f.bak')
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith('manifest.json')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { scanForHardcodedStrings } from '../scanner.js'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  lstatSync: vi.fn(),
  statSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true)
}))

describe('scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
    vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => true, isFile: () => false } as any)
  })

  it('detects strings in Vue and React files', () => {
    // 1. Setup Vue file in src/components
    vi.mocked(fs.readdirSync).mockImplementation((path: any) => {
        if (path.toString().includes('components')) return ['App.vue'] as any
        return [] as any
    })
    
    vi.mocked(fs.statSync).mockImplementation((path: any) => {
        if (path.toString().endsWith('App.vue')) return { isDirectory: () => false, isFile: () => true } as any
        return { isDirectory: () => true, isFile: () => false } as any
    })

    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        if (path.toString().endsWith('.vue')) return '<template><div>Hello Vue</div></template><script>const x = "Vue script"</script>'
        return ''
    })

    const report = scanForHardcodedStrings({ scanPaths: ['src/components'] }, '/root')
    
    expect(report.totalFiles).toBe(1)
    expect(report.totalStrings).toBe(2)
    expect(report.results.map(r => r.hardcodedString)).toContain('Hello Vue')
    expect(report.results.map(r => r.hardcodedString)).toContain('Vue script')
  })

  it('categorizes results accurately', () => {
    vi.mocked(fs.readdirSync).mockImplementation((path: any) => {
        if (path.toString().includes('components')) return ['Btn.tsx'] as any
        return [] as any
    })
    vi.mocked(fs.statSync).mockImplementation((path: any) => {
        if (path.toString().endsWith('Btn.tsx')) return { isDirectory: () => false, isFile: () => true } as any
        return { isDirectory: () => true, isFile: () => false } as any
    })
    vi.mocked(fs.readFileSync).mockReturnValue('const B = () => <button>Click Me</button>')

    const report = scanForHardcodedStrings({ scanPaths: ['src/components'] }, '/root')
    
    expect(report.categorizedResults.buttons).toHaveLength(1)
    expect(report.results[0].category).toBe('buttons')
  })
})

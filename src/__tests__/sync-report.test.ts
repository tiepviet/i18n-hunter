import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { syncReportMd } from '../sync-report.js'

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn()
}))

describe('syncReportMd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockImplementation((path: any) => path.includes('.json'))
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        totalFiles: 1,
        totalStrings: 1,
        results: [{
            filePath: 'App.vue',
            lineNumber: 1,
            columnNumber: 1,
            hardcodedString: 'Hello World',
            suggestedKey: 'msg.hello',
            context: 'tag:div',
            category: 'label'
        }],
        categorizedResults: {
            labels: [{
                filePath: 'App.vue',
                lineNumber: 1,
                columnNumber: 1,
                hardcodedString: 'Hello World',
                suggestedKey: 'msg.hello',
                context: 'tag:div',
                category: 'label'
            }],
            buttons: [],
            messages: [],
            errors: [],
            notifications: []
        }
    }))
  })

  it('reads JSON and creates Markdown report', () => {
    const result = syncReportMd('src/report.json')
    expect(result.mdPath).toBe('src/report.md')
    expect(fs.writeFileSync).toHaveBeenCalled()
    const content = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
    expect(content).toContain('# i18n-hunter Hunt Report')
    expect(content).toContain('msg.hello')
  })

  it('throws error if JSON file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(() => syncReportMd('missing.json')).toThrow(/not found/)
  })
})

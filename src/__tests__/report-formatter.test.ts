import { describe, it, expect } from 'vitest'
import { generateMarkdownReport, generateJsonReport, generateSummary } from '../report-formatter.js'
import type { ExtractionReport } from '../types.js'

const makeReport = (): ExtractionReport => ({
  totalFiles: 5,
  totalStrings: 3,
  results: [
    {
      filePath: 'src/components/Foo.vue',
      lineNumber: 10,
      columnNumber: 3,
      hardcodedString: 'Save',
      context: 'template',
      suggestedKey: 'common.actions.save',
      category: 'button',
    },
  ],
  categorizedResults: {
    labels: [],
    buttons: [
      {
        filePath: 'src/components/Foo.vue',
        lineNumber: 10,
        columnNumber: 3,
        hardcodedString: 'Save',
        context: 'template',
        suggestedKey: 'common.actions.save',
        category: 'button',
      },
    ],
    messages: [],
    errors: [],
    notifications: [],
  },
})

describe('generateMarkdownReport', () => {
  it('contains report header', () => {
    const md = generateMarkdownReport(makeReport())
    expect(md).toContain('# i18n-hunter Hunt Report')
  })

  it('contains file count', () => {
    const md = generateMarkdownReport(makeReport())
    expect(md).toContain('5')
  })

  it('contains suggested key', () => {
    const md = generateMarkdownReport(makeReport())
    expect(md).toContain('common.actions.save')
  })
})

describe('generateJsonReport', () => {
  it('is valid JSON', () => {
    const json = generateJsonReport(makeReport())
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('includes totalFiles', () => {
    const parsed = JSON.parse(generateJsonReport(makeReport()))
    expect(parsed.totalFiles).toBe(5)
  })
})

describe('generateSummary', () => {
  it('contains button count', () => {
    const summary = generateSummary(makeReport())
    expect(summary).toContain('Buttons:')
    expect(summary).toContain('1')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { scanForHardcodedStrings } from '../scanner.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('scanner integration', () => {
  it('scans a mixed Vue and React project with deterministic v2 findings', async () => {
    project = createTempProject()
    const react = project.write(
      'src/App.tsx',
      `import { useTranslation } from 'react-i18next'\nexport const App = () => { const { t } = useTranslation(); return <main><h1>Welcome home</h1><p>{t('common.msg.existing')}</p></main> }`,
    )
    const vue = project.write(
      'src/components/Card.vue',
      `<template><button aria-label="Close dialog">Close</button></template><script setup>toast.success('Saved')</script>`,
    )

    const report = await scanForHardcodedStrings({ includeValues: true }, project.root)

    expect(report.schemaVersion).toBe(2)
    expect(report.complete).toBe(true)
    expect(report.summary.filesDiscovered).toBe(2)
    expect(report.summary.filesScanned).toBe(2)
    expect(report.findings.map((item) => item.hardcodedString)).toEqual([
      'Welcome home',
      'Close dialog',
      'Close',
      'Saved',
    ])
    for (const finding of report.findings) {
      const content = finding.filePath.endsWith('.tsx')
        ? project.read('src/App.tsx')
        : project.read('src/components/Card.vue')
      expect(finding.fileSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(finding.range.end).toBeGreaterThan(finding.range.start)
      expect(content.slice(finding.range.start, finding.range.end)).toBeTruthy()
    }
    expect(react).toMatch(/src\/App\.tsx$/u)
    expect(vue).toMatch(/src\/components\/Card\.vue$/u)
  })

  it('includes source values only when explicitly requested', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Private preview</div>')

    const report = await scanForHardcodedStrings({ includeValues: true }, project.root)

    expect(report.findings[0]?.hardcodedString).toBe('Private preview')
  })

  it('does not serialize absolute filesystem paths in diagnostics', async () => {
    project = createTempProject()
    project.write('src/Big.tsx', `export const App = () => <div>${'x'.repeat(2_100_000)}</div>`)

    const report = await scanForHardcodedStrings(
      { scanPaths: ['src'], limits: { maxFileBytes: 1_000_000 } },
      project.root,
    )

    expect(report.diagnostics[0]?.message).not.toContain(project.root)
    expect(report.complete).toBe(false)
  })

  it('marks the scan incomplete when a source file cannot be parsed', async () => {
    project = createTempProject()
    project.write('src/Broken.tsx', 'export const App = () => <div>Broken')

    const report = await scanForHardcodedStrings({}, project.root)

    expect(report.complete).toBe(false)
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'E_PARSE_FAILED' })]),
    )
  })
})

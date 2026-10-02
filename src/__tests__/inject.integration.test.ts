import { parse } from '@babel/parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForHardcodedStrings } from '../scanner.js'
import { createFileTransformPlan } from '../transform.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

beforeEach(() => {
  project = createTempProject()
})
afterEach(() => project?.cleanup())

async function plan(path: string, source: string) {
  project!.write(path, source)
  const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project!.root)
  return createFileTransformPlan(
    source,
    path,
    report.findings.filter((finding) => finding.filePath === path),
  )
}

describe('framework binding injection', () => {
  it('reuses an existing React translation hook without duplicates', async () => {
    const source = `import { useTranslation } from 'react-i18next'\nexport const App = () => { const { t } = useTranslation(); return <div title="Welcome">{t('common.msg.existing')}</div> }`
    const result = await plan('src/App.tsx', source)

    expect(result.content.match(/useTranslation\(\)/gu)).toHaveLength(1)
    expect(result.content.match(/const \{ t \}/gu)).toHaveLength(1)
    expect(() => parse(result.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('uses a non-conflicting alias when a component already binds t', async () => {
    const source = `import { useTranslation } from 'react-i18next'\nexport const App = () => { const t = (key) => key; return <div>Visible message</div> }`
    const result = await plan('src/App.tsx', source)

    expect(result.content).toContain('const { t: i18nT } = useTranslation()')
    expect(result.content).toContain("{i18nT('src.lbl.u_")
  })

  it('reuses an existing Vue useI18n binding', async () => {
    const source = `<template><button>Save</button></template>\n<script setup>\nimport { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\ntoast.success(t('common.msg.saved'))\n</script>`
    const result = await plan('src/App.vue', source)

    expect(result.content.match(/from 'vue-i18n'/gu)).toHaveLength(1)
    expect(result.content.match(/useI18n\(\)/gu)).toHaveLength(1)
    expect(result.content).not.toContain('const { t: i18nT }')
  })

  it('calls aliased React and Vue i18n hooks instead of undefined canonical names', async () => {
    const reactSource =
      "import { useTranslation as useT } from 'react-i18next'\nexport const App = () => <div>Aliased React message</div>"
    const reactResult = await plan('src/App.tsx', reactSource)
    expect(reactResult.content).toContain('const { t } = useT()')
    expect(reactResult.content).not.toContain('useTranslation()')

    const vueSource = `<template><button>Aliased Vue message</button></template>\n<script setup>\nimport { useI18n as useVueI18n } from 'vue-i18n'\nconst message = 'Saved from Vue'\n</script>`
    const vueResult = await plan('src/Card.vue', vueSource)
    expect(vueResult.content).toContain('const { t } = useVueI18n()')
    expect(vueResult.content).not.toContain('useI18n()')
  })

  it('injects independent bindings for nested function components', async () => {
    const source = `export const Outer = () => { const Inner = () => <span>Inner message</span>; return <div>Outer message<Inner /></div> }`
    const result = await plan('src/Nested.tsx', source)

    expect(result.content.match(/useTranslation\(\)/gu)).toHaveLength(2)
    expect(result.content.match(/const \{ t(?:: i18nT)? \}/gu)).toHaveLength(2)
    expect(() => parse(result.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('marks class components as incomplete instead of guessing a hook location', async () => {
    const source = `import React from 'react'\nexport class App extends React.Component { render() { return <div>Class message</div> } }`
    project!.write('src/App.tsx', source)
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project!.root)

    expect(report.complete).toBe(false)
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'E_UNSUPPORTED_TRANSFORM' })]),
    )
    await expect(createFileTransformPlan(source, 'src/App.tsx', report.findings)).rejects.toThrow(
      /component|unsupported/i,
    )
  })
})

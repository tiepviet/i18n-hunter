import { parse } from '@babel/parser'
import { parse as parseSfc, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { afterEach, describe, expect, it } from 'vitest'
import { scanForHardcodedStrings } from '../scanner.js'
import { createFileTransformPlan } from '../transform.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

async function findingsFor(path: string, content: string) {
  project?.write(path, content)
  const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project!.root)
  return report.findings.filter((finding) => finding.filePath === path)
}

describe('source transforms', () => {
  it('rejects stale reports before producing content', async () => {
    project = createTempProject()
    const source = 'export const App = () => <div>Hello</div>'
    const findings = await findingsFor('src/App.tsx', source)
    const stale = structuredClone(findings)
    stale[0]!.fileSha256 = 'f'.repeat(64)

    await expect(createFileTransformPlan(`${source}\n`, 'src/App.tsx', stale)).rejects.toThrow(
      /stale|source/i,
    )
  })

  it('transforms duplicate same-line React occurrences independently and reparses', async () => {
    project = createTempProject()
    const source = `export const Card = () => <button title="Save">Save</button>`
    const findings = await findingsFor('src/Card.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/Card.tsx', findings)

    expect(plan.content).toContain('title={t(')
    expect(plan.content).toContain('>{t(')
    expect(() =>
      parse(plan.content, { sourceType: 'module', plugins: ['jsx', 'typescript'] }),
    ).not.toThrow()
  })

  it('wraps a concise parenthesized arrow without leaving orphaned parentheses', async () => {
    project = createTempProject()
    const source = `export const App = () => (\n  <div>\n    Parenthesized message\n  </div>\n)`
    const findings = await findingsFor('src/App.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)

    expect(plan.content).toContain('return (')
    expect(plan.content).toContain('const { t } = useTranslation()')
    expect(() => parse(plan.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('replaces JSX expression string literals with real expressions', async () => {
    project = createTempProject()
    const source = `const App = () => <input placeholder={'Search now'} />`
    const findings = await findingsFor('src/App.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)

    expect(plan.content).toContain("placeholder={t('")
    expect(plan.content).not.toContain("'{t(")
    expect(() => parse(plan.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('preserves CRLF line endings in injected React code', async () => {
    project = createTempProject()
    const source = 'export const App = () => {\r\n  return <div>CRLF message</div>\r\n}\r\n'
    const findings = await findingsFor('src/App.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)

    expect(plan.content).not.toMatch(/(?<!\r)\n/u)
    expect(() => parse(plan.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('injects scoped hooks into multiple React components and preserves use client', async () => {
    project = createTempProject()
    const source = `'use client'\nexport const First = () => <div>First message</div>\nexport const Second = () => <div>Second message</div>`
    const findings = await findingsFor('src/views.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/views.tsx', findings)

    expect(plan.content.startsWith("'use client'")).toBe(true)
    expect(plan.content.match(/const \{ t \} = useTranslation\(\)/gu)).toHaveLength(2)
    expect(plan.content.indexOf('import { useTranslation }')).toBeGreaterThan(
      plan.content.indexOf("'use client'"),
    )
    expect(() => parse(plan.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('produces compilable Vue template and script-setup output', async () => {
    project = createTempProject()
    const source = `<template><button aria-label="Close dialog">Close</button></template>\n<script setup>toast.success('Saved')</script>`
    const findings = await findingsFor('src/Card.vue', source)
    const plan = await createFileTransformPlan(source, 'src/Card.vue', findings)
    const descriptor = parseSfc(plan.content, { filename: 'src/Card.vue' }).descriptor

    expect(plan.content).toContain(':aria-label="$t(')
    expect(plan.content).toContain('const { t } = useI18n()')
    expect(() => compileScript(descriptor, { id: 'test' })).not.toThrow()
    expect(
      compileTemplate({
        source: descriptor.template!.content,
        id: 'test',
        filename: 'src/Card.vue',
      }).errors,
    ).toEqual([])
  })

  it('converts interpolated template literals using i18n interpolation values', async () => {
    project = createTempProject()
    const source = `const App = () => <p>{\`Welcome \${name}!\`}</p>`
    const findings = await findingsFor('src/App.tsx', source)
    const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)

    expect(plan.content).toMatch(/t\('[^']+', \{ 0: name \}\)/u)
    expect(() => parse(plan.content, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('rejects script transforms without a component scope', async () => {
    project = createTempProject()
    const source = `export function notify() { toast.success('Saved') }`
    const findings = await findingsFor('src/notify.ts', source)

    await expect(createFileTransformPlan(source, 'src/notify.ts', findings)).rejects.toThrow(
      /component|unsupported/i,
    )
  })
})

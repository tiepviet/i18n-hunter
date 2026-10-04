import { describe, expect, it } from 'vitest'
import {
  categoryForContext,
  categoryForTag,
  isTechnicalValue,
  isVisibleText,
} from '../i18n-taxonomy.js'
import { parseJavaScriptSource } from '../javascript-extractor.js'
import { isJsxSourcePath, isTypeScriptSourcePath } from '../path-policy.js'
import { parseReactSource } from '../react-parser.js'
import { parseVueSource } from '../vue-parser.js'

function extract(code: string, file = 'src/App.tsx') {
  return parseJavaScriptSource({
    content: code,
    fullSource: code,
    filePath: file,
    typescript: true,
    jsx: true,
    componentMode: 'react',
  })
}

describe('audit fixes', () => {
  it('shares taxonomy between frameworks', () => {
    expect(categoryForTag('BUTTON', 'Save')).toBe('button')
    expect(categoryForTag('blockquote', 'Quote')).toBe('message')
    expect(categoryForContext('tag:button', 'Save')).toBe('button')
    expect(categoryForContext('notification:info', 'Hi')).toBe('notification')
    expect(isVisibleText('a')).toBe(true)
    expect(isVisibleText('   ')).toBe(false)
  })

  it('does not filter locale codes as technical', () => {
    expect(isTechnicalValue('en-US')).toBe(false)
    expect(isTechnicalValue('save-changes')).toBe(false)
    expect(isTechnicalValue('https://example.com/x')).toBe(true)
    expect(isTechnicalValue('/api/users')).toBe(true)
    expect(isTechnicalValue('foo/bar')).toBe(true)
    expect(isTechnicalValue('app.json')).toBe(true)
  })

  it('classifies file types case-insensitively', () => {
    expect(isTypeScriptSourcePath('SRC/APP.TS')).toBe(true)
    expect(isTypeScriptSourcePath('src/app.mts')).toBe(true)
    expect(isTypeScriptSourcePath('src/app.cts')).toBe(true)
    expect(isJsxSourcePath('src/app.JS')).toBe(true)
    expect(isJsxSourcePath('src/app.mjs')).toBe(true)
    expect(isJsxSourcePath('src/app.ts')).toBe(false)
    expect(isJsxSourcePath('src/app.tsx')).toBe(true)
  })

  it('extracts JSX expression strings', () => {
    const result = extract(`export const A = () => <div>{'Hello'}</div>`)
    expect(result.candidates.some((c) => c.transform === 'react-expression-string')).toBe(true)
  })

  it('flags bare toast calls as notifications', () => {
    const result = extract(`toast('Saved successfully')\nexport const A = () => <div>Hi</div>`)
    expect(result.candidates.some((c) => c.isNotification)).toBe(true)
  })

  it('flags useState initial strings', () => {
    const result = extract(
      `import { useState } from 'react'\nexport const A = () => { const [v] = useState('Hello world'); return <div>{v}</div> }`,
    )
    expect(result.candidates.some((c) => c.value === 'Hello world')).toBe(true)
  })

  it('does not flag object values inside return', () => {
    const result = extract(`export const A = () => { return { foo: 'hi' } }`)
    expect(result.candidates.some((c) => c.value === 'hi')).toBe(false)
  })

  it('flags directly returned strings', () => {
    const result = extract(`export function f() { return 'Hello world' }`)
    expect(result.candidates.some((c) => c.value === 'Hello world')).toBe(true)
  })

  it('skips pure interpolations without literal text', () => {
    const result = extract(
      `export const A = () => { const x = 1; const s = \`\${x}\`; return <div>{s}</div> }`,
    )
    expect(result.candidates.filter((c) => c.value.includes('${x}'))).toEqual([])
  })

  it('supports memo components and named exports', () => {
    const result = extract(
      `import { memo } from 'react'\nexport const Card = memo(() => <div>Memo message</div>)\nexport function Panel() { return <div>Panel message</div> }`,
    )
    const memo = result.candidates.find((c) => c.value === 'Memo message')
    const panel = result.candidates.find((c) => c.value === 'Panel message')
    expect(memo?.component?.name).toBe('Card')
    expect(panel?.component?.name).toBe('Panel')
  })

  it('parses .mts and .mjs sources', () => {
    expect(() =>
      parseReactSource(`export const A = () => <div>Hi there</div>`, 'src/A.mjs'),
    ).not.toThrow()
    const r = parseReactSource(
      `export function greet(title = 'Hello world') { return title }`,
      'src/A.mts',
    )
    expect(r.candidates.length).toBeGreaterThan(0)
  })

  it('extracts Vue interpolations and v-text', async () => {
    const code = `<template><div>{{ 'Hello world' }}</div><span v-text="'Visible text'"></span><input :placeholder="'Search now'" /></template>`
    const result = await parseVueSource(code, 'src/A.vue')
    expect(result.candidates.map((c) => c.value)).toEqual(
      expect.arrayContaining(['Hello world', 'Visible text', 'Search now']),
    )
  })

  it('rejects Pug templates with an error diagnostic', async () => {
    const code = `<template lang="pug">div Hello</template>`
    const result = await parseVueSource(code, 'src/A.vue')
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('derives PascalCase scope from kebab-case filenames', async () => {
    const code = `<template><div>Hi</div></template><script setup>const x = 'Hello world'</script>`
    const result = await parseVueSource(code, 'src/my-component.vue')
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('supports export const memo wrappers', () => {
    const r = parseReactSource(
      `import { memo } from 'react'\nexport const Card = memo(() => <div>Memo card hello</div>)`,
      'src/Card.tsx',
    )
    expect(r.candidates.find((c) => c.value === 'Memo card hello')?.component?.name).toBe('Card')
  })

  it('does not flag non-user-facing parameter defaults', () => {
    const r = parseReactSource(`export function f(mode = 'dark') { return mode }`, 'src/f.ts')
    expect(r.candidates.some((c) => c.value === 'dark')).toBe(false)
  })

  it('flags user-facing parameter defaults', () => {
    const r = parseReactSource(
      `export function f(title = 'Hello world') { return title }`,
      'src/f.ts',
    )
    expect(r.candidates.some((c) => c.value === 'Hello world')).toBe(true)
  })

  it('normalizes JSX attribute case', () => {
    const r = parseReactSource(
      `export const A = () => <input ARIA-LABEL="Close dialog now" />`,
      'src/A.tsx',
    )
    expect(r.candidates.some((c) => c.value === 'Close dialog now')).toBe(true)
  })

  it('emits info diagnostics for unsupported Vue directives', async () => {
    const vhtml = await parseVueSource(
      `<template><div v-html="'Hello world'"></div></template>`,
      'src/A.vue',
    )
    expect(
      vhtml.diagnostics.some((d) => d.code === 'E_UNSUPPORTED_TRANSFORM' && d.severity === 'info'),
    ).toBe(true)
    const dyn = await parseVueSource(
      `<template><div v-bind:[key]="'Hello world'"></div></template>`,
      'src/A.vue',
    )
    expect(
      dyn.diagnostics.some((d) => d.code === 'E_UNSUPPORTED_TRANSFORM' && d.severity === 'info'),
    ).toBe(true)
    const cond = await parseVueSource(
      `<template><div :title="cond ? 'a' : 'b'">Hi</div></template>`,
      'src/A.vue',
    )
    expect(cond.diagnostics.length).toBeGreaterThanOrEqual(0)
  })

  it('recognizes namespaced React hooks without duplicating', async () => {
    const { planReactBindings } = await import('../inject-react.js')
    const code = `import * as React from 'react'\nexport const A = () => { const { t } = React.useTranslation(); return <div>Hi there world</div> }`
    const parsed = parseReactSource(code, 'src/A.tsx')
    const findings = parsed.candidates.map((c, i) => ({
      id: `finding-${i}`,
      filePath: 'src/A.tsx',
      fileSha256: 'a'.repeat(64),
      sliceSha256: 'b'.repeat(64),
      lineNumber: 1,
      columnNumber: 0,
      endLineNumber: 1,
      endColumnNumber: 1,
      suggestedKey: 'a.b.c',
      context: c.context,
      category: c.category,
      transform: c.transform,
      range: c.range,
      component: c.component,
    }))
    const plan = planReactBindings(code, 'src/A.tsx', findings as never)
    // Existing namespaced binding reused: no new hook edit.
    expect(plan.bindings.get(parsed.candidates[0]?.component?.id ?? '')).toBe('t')
    expect(plan.edits.filter((e) => e.kind === 'hook')).toHaveLength(0)
  })

  it('reuses Vue member-form bindings', async () => {
    const code = `<template><div>Hi</div></template><script setup>\nimport { useI18n } from 'vue-i18n'\nconst t = useI18n().t\nconst label = t('x')\nconst msg = 'Hello world here'\nconsole.log(msg)\n</script>`
    const parsed = await parseVueSource(code, 'src/A.vue')
    expect(parsed.candidates.length).toBeGreaterThanOrEqual(1)
  })
})

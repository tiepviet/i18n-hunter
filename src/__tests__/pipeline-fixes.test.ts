import { describe, expect, it } from 'vitest'
import { categoryForTag, normalizeAttributeName } from '../i18n-taxonomy.js'
import { parseJavaScriptSource } from '../javascript-extractor.js'
import { hashText } from '../source-range.js'
import { parseVueSource } from '../vue-parser.js'

function extract(code: string) {
  return parseJavaScriptSource({
    content: code,
    fullSource: code,
    filePath: 'src/App.tsx',
    typescript: true,
    jsx: true,
    componentMode: 'react',
  })
}

describe('H2 entity range', () => {
  it('vue text range covers raw entity while value is decoded', async () => {
    const code = `<template><h1>Hello &amp; welcome</h1></template>`
    const result = await parseVueSource(code, 'src/App.vue')
    const candidate = result.candidates.find((c) => c.value === 'Hello & welcome')
    expect(candidate).toBeDefined()
    const slice = code.slice(candidate!.range.start, candidate!.range.end)
    expect(slice).toBe(candidate!.raw)
    expect(slice).toBe('Hello &amp; welcome')
    expect(candidate!.range.end - candidate!.range.start).toBe(slice.length)
    expect(hashText(slice)).toBe(hashText(candidate!.raw))
    expect(hashText(slice)).not.toBe(hashText(candidate!.value))
  })

  it('react jsx text range covers raw entity while value is decoded', async () => {
    const { parseReactSource } = await import('../react-parser.js')
    const code = `export const App = () => <span>Hello &amp; welcome</span>`
    const result = parseReactSource(code, 'src/App.tsx')
    const candidate = result.candidates.find((c) => c.value === 'Hello & welcome')
    expect(candidate).toBeDefined()
    const slice = code.slice(candidate!.range.start, candidate!.range.end)
    expect(slice).toBe(candidate!.raw)
    expect(slice).toBe('Hello &amp; welcome')
    expect(hashText(slice)).toBe(hashText(candidate!.raw))
  })
})

describe('M4 all-ancestor calls', () => {
  it('filters console.log(foo(hello)) outer technical', () => {
    const result = extract(`console.log(toast('hello world here'))`)
    expect(result.candidates.some((c) => c.value === 'hello world here')).toBe(false)
  })

  it('marks toast(foo(hello)) as notification', () => {
    const result = extract(`toast(foo('hello world here'))\nexport const A = () => <div>Hi</div>`)
    const found = result.candidates.find((c) => c.value === 'hello world here')
    expect(found?.isNotification).toBe(true)
  })

  it('filters JSON outer technical wrapping notification', () => {
    const result = extract(`JSON.stringify(toast('hello world here'))`)
    expect(result.candidates.some((c) => c.value === 'hello world here')).toBe(false)
  })

  it('filters console wrapping useState string', () => {
    const result = extract(`console.log(useState('hello world here'))`)
    expect(result.candidates.some((c) => c.value === 'hello world here')).toBe(false)
  })
})

describe('M5 taxonomy', () => {
  it('does not match terror as error but matches error terms with boundaries', () => {
    expect(categoryForTag('p', 'terror alert')).not.toBe('error')
    expect(categoryForTag('p', 'An error occurred')).toBe('error')
    expect(categoryForTag('p', 'Access forbidden')).toBe('error')
    expect(categoryForTag('p', 'Access denied')).toBe('error')
    expect(categoryForTag('p', 'File missing')).toBe('error')
    expect(categoryForTag('p', 'Operation fail')).toBe('error')
  })

  it('normalizes camelCase attributes generally', () => {
    expect(normalizeAttributeName('ariaLabel')).toBe('aria-label')
    expect(normalizeAttributeName('ARIALABEL')).toBe('aria-label')
    expect(normalizeAttributeName('ariaDescription')).toBe('aria-description')
    expect(normalizeAttributeName('placeholder')).toBe('placeholder')
  })

  it('flags alert/message callees as notifications', () => {
    const a = extract(`alert('hello world here')\nexport const A = () => <div>Hi</div>`)
    expect(a.candidates.some((c) => c.value === 'hello world here' && c.isNotification)).toBe(true)
    const m = extract(`message.success('hello world here')\nexport const A = () => <div>Hi</div>`)
    expect(m.candidates.some((c) => c.value === 'hello world here' && c.isNotification)).toBe(true)
  })
})

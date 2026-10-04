import { describe, expect, it } from 'vitest'
import { parseVueSource } from '../vue-parser.js'

describe('Vue starvation fixes (R1+R2+R3)', () => {
  it('external template + inline script still extracts script strings', async () => {
    const code = `<template src="./other.html"></template>\n<script>toast.success('Saved successfully')</script>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.diagnostics.some((item) => item.code === 'E_UNSUPPORTED_TRANSFORM')).toBe(true)
    expect(result.candidates.map((item) => item.value)).toContain('Saved successfully')
  })

  it(':Title bound preserves source case', async () => {
    const code = `<template><input :Title="'Hello World'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates.map((item) => [item.value, item.context])).toContainEqual([
      'Hello World',
      'attribute:Title',
    ])
  })

  it(":title=\"cond ? 'a' : 'b'\" extracts both literals", async () => {
    const code = `<template><input :title="cond ? 'a' : 'b'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')
    const values = result.candidates.map((item) => item.value)

    expect(values).toContain('a')
    expect(values).toContain('b')
    for (const item of result.candidates) {
      expect(code.slice(item.range.start, item.range.end)).toBe(item.raw)
    }
  })
})

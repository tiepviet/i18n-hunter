import { describe, expect, it } from 'vitest'
import { parseVueSource } from '../vue-parser.js'

describe('Vue literal edge cases', () => {
  it('reports template literals in interpolation instead of silent 0', async () => {
    const code = '<template><div>{{ `hi ${x}` }}</div></template>'
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates).toEqual([])
    expect(
      result.diagnostics.some(
        (item) =>
          item.severity === 'info' &&
          item.code === 'E_UNSUPPORTED_TRANSFORM' &&
          item.message.includes('Template literals need per-quasi mapping'),
      ),
    ).toBe(true)
  })

  it('reports dynamic binding arguments specifically', async () => {
    const code = `<template><div v-bind:[k]="'x'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates).toEqual([])
    expect(
      result.diagnostics.some((item) =>
        item.message.includes('Unsupported dynamic Vue binding argument'),
      ),
    ).toBe(true)
  })
})

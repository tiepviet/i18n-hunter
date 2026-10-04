import { describe, expect, it } from 'vitest'
import { parseVueSource } from '../vue-parser.js'

describe('Vue normalize (N2+N4)', () => {
  it('extracts camelCase ariaLabel in Vue like React', async () => {
    const code = `<template><input ariaLabel="Search label" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')
    expect(result.candidates.map((item) => item.value)).toContain('Search label')
  })

  it('classifies :title="\'v-text\'" as attribute:title not directive:v-text', async () => {
    const code = `<template><div :title="'v-text'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')
    expect(result.candidates.map((item) => [item.value, item.context])).toEqual([
      ['v-text', 'attribute:title'],
    ])
  })

  it('still extracts v-text directive', async () => {
    const code = `<template><span v-text="'Visible'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')
    expect(result.candidates.map((item) => [item.value, item.context])).toEqual([
      ['Visible', 'directive:v-text'],
    ])
  })
})

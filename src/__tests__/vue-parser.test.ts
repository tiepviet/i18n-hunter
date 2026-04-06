import { describe, it, expect, vi } from 'vitest'
import { 
  parseVueComponent, 
  extractTemplateStrings, 
  extractScriptStrings 
} from '../vue-parser.js'
import * as compilerDom from '@vue/compiler-dom'

describe('vue-parser', () => {
  const vueContent = `
<template>
  <div>Hello Vue</div>
  <button :label="'Prop'"></button>
  <img alt="Bird" />
</template>
<script setup>
const msg = "Script Text"
const title = "Welcome to i18n-hunter"
</script>
`

  it('parses a basic Vue SFC', () => {
    const parsed = parseVueComponent(vueContent, 'App.vue')
    expect(parsed?.template?.content).toContain('Hello Vue')
    expect(parsed?.scriptSetup?.content).toContain('Script Text')
  })

  it('extracts strings from template AST', () => {
    const template = '<div>{{ $t("key") }} Hello World <button alt="Action">Click</button></div>'
    const strings = extractTemplateStrings(template, 1)
    
    expect(strings.map(s => s.value)).toContain('Hello World')
    expect(strings.map(s => s.value)).toContain('Action')
    expect(strings.map(s => s.value)).toContain('Click')
    expect(strings.find(s => s.value === 'Action')?.context).toBe('attribute:alt:label')
  })

  it('extracts strings from script blocks', () => {
    const script = `
const x = "Hello Script"
console.log("ignore me")
toast.success("Updated!")
`
    const strings = extractScriptStrings(script, 10)
    
    expect(strings.map(s => s.value)).toContain('Hello Script')
    expect(strings.map(s => s.value)).toContain('Updated!')
    expect(strings.find(s => s.value === 'Updated!')?.isNotification).toBe(true)
    // console.log line should be skipped
    expect(strings.filter(s => s.value === 'ignore me')).toHaveLength(0)
  })

  it('skips technical strings and common attributes', () => {
    const template = '<div class="btn-primary" id="main-val">Skip</div>'
    const strings = extractTemplateStrings(template, 1)
    expect(strings.map(s => s.value)).not.toContain('btn-primary')
    expect(strings.map(s => s.value)).not.toContain('main-val')
  })

  it('falls back to regex when AST parser fails', () => {
    // 1. Mock parseTemplate to throw
    const spy = vi.spyOn(compilerDom, 'parse').mockImplementation(() => {
        throw new Error('Parse error')
    })

    const template = '<div>Fallback Text</div>'
    const strings = extractTemplateStrings(template, 1)
    
    expect(strings.map(s => s.value)).toContain('Fallback Text')
    expect(strings[0].context).toBe('text-node')
    
    spy.mockRestore()
  })
})

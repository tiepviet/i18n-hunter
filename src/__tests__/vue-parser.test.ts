import { describe, expect, it } from 'vitest'
import { parseVueSource } from '../vue-parser.js'

describe('Vue AST extraction', () => {
  it('extracts exact template text and user-facing attribute ranges', async () => {
    const code = `<template>\n  <h1>Hello &amp; welcome</h1>\n  <input aria-label="Search &amp; find" placeholder="Search" />\n</template>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.diagnostics).toEqual([])
    expect(result.candidates.map((item) => item.value)).toEqual([
      'Hello & welcome',
      'Search & find',
      'Search',
    ])
    for (const item of result.candidates) {
      expect(code.slice(item.range.start, item.range.end)).toBe(item.raw)
    }
  })

  it('extracts notification strings from script setup and skips existing i18n calls', async () => {
    const code = `<template><button>Save</button></template>\n<script setup lang="ts">\nimport { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\nconst message = t('common.msg.existing')\ntoast.success('Saved successfully')\n</script>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates.map((item) => item.value)).toEqual(['Save', 'Saved successfully'])
    expect(result.candidates[1]).toMatchObject({
      category: 'notification',
      notificationType: 'success',
      component: { kind: 'vue-script-setup' },
    })
  })

  it('extracts literal expressions from bound attributes and v-text', async () => {
    const code = `<template><input :placeholder="'Search'" /><span v-text="'Visible'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates.map((item) => [item.value, item.context])).toEqual([
      ['Search', 'attribute:placeholder'],
      ['Visible', 'directive:v-text'],
    ])
  })

  it('rejects technical and dynamic bound attributes', async () => {
    const code = `<template><img :src="'https://cdn.example.com/logo.png'" :alt="'Logo alt'" /><input :type="'password'" /><div v-bind:[dynamicKey]="'Dynamic value'" /></template>`
    const result = await parseVueSource(code, 'src/App.vue')

    expect(result.candidates.map((item) => item.value)).toEqual(['Logo alt'])
  })

  it('reports malformed files instead of silently falling back to regex extraction', async () => {
    const code = `<template><div>Unclosed</template><script setup>const x = </script>`
    const result = await parseVueSource(code, 'src/Broken.vue')

    expect(result.candidates).toEqual([])
    expect(result.diagnostics.some((item) => item.code === 'E_PARSE_FAILED')).toBe(true)
  })
})

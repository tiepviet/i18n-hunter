import { describe, expect, it } from 'vitest'
import { generateSmartKey } from '../key-generator.js'
import { keySchema } from '../report-schema.js'
import type { FindingCategory } from '../types.js'

describe('generateSmartKey', () => {
  it('generates deterministic semantic keys', () => {
    expect(generateSmartKey('Sign in to your account', 'login', 'label')).toBe(
      'login.lbl.sign_in_to_your_account',
    )
  })

  it('uses a stable non-empty fallback for non-latin text', () => {
    const first = generateSmartKey('保存', 'settings', 'button')
    const second = generateSmartKey('保存', 'settings', 'button')

    expect(first).toBe(second)
    expect(first).toMatch(/^settings\.btn\.u_[a-f0-9]{8}$/)
  })

  it('never emits invalid key segments for punctuation-only values', () => {
    expect(generateSmartKey('!!!', 'common', 'message')).toMatch(/^common\.msg\.u_[a-f0-9]{8}$/)
  })

  it('bounds segment length and total key length', () => {
    const key = generateSmartKey('word '.repeat(100), 'a'.repeat(200), 'message')
    expect(key.length).toBeLessThanOrEqual(200)
    expect(key.split('.')).toHaveLength(3)
  })

  it('bounds the segment count for deeply nested paths', () => {
    const scope = Array.from({ length: 40 }, (_, index) => `dir${index}`).join('/')
    const key = generateSmartKey('Deeply nested message', scope, 'label')

    expect(key.split('.')).toHaveLength(15)
    expect(key.length).toBeLessThanOrEqual(200)
  })

  it('always produces a key the report schema accepts', () => {
    const scopes = [
      'login',
      'src/components',
      Array.from({ length: 40 }, (_, index) => `d${index}`).join('.'),
      Array.from({ length: 40 }, (_, index) => `d${index}`).join('/'),
      'a'.repeat(300),
      '',
      '...',
    ]
    const texts = ['Save', '保存', '!!!', 'x'.repeat(500), '', 'a b c']
    const categories: FindingCategory[] = ['label', 'button', 'message', 'error', 'notification']

    for (const scope of scopes) {
      for (const text of texts) {
        for (const category of categories) {
          const key = generateSmartKey(text, scope, category)
          const parsed = keySchema.safeParse(key)
          expect(parsed.success, `${JSON.stringify({ scope, text, category, key })}`).toBe(true)
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { parseReactSource } from '../react-parser.js'

describe('React AST extraction', () => {
  it('extracts exact ranges for JSX text and user-facing attributes', () => {
    const code = `export const App = () => (\n  <div title="Welcome"><span>Hello &amp; welcome</span><input placeholder="Search" /></div>\n)`
    const result = parseReactSource(code, 'src/App.tsx')

    expect(result.diagnostics).toEqual([])
    expect(result.candidates.map((item) => item.value)).toEqual([
      'Welcome',
      'Hello & welcome',
      'Search',
    ])
    for (const item of result.candidates) {
      expect(code.slice(item.range.start, item.range.end)).toBe(item.raw)
    }
  })

  it('skips existing translation calls, imports, technical attributes, and metadata', () => {
    const code = `
      import { useTranslation } from 'react-i18next'
      const cls = 'flex items-center'
      const method = 'GET'
      const contentType = 'application/json'
      const App = () => {
        const { t } = useTranslation()
        return <div className={cls} data-test="User profile">{t('common.msg.hello')}<span>Visible text</span></div>
      }
    `
    const result = parseReactSource(code, 'src/App.tsx')

    expect(result.candidates.map((item) => item.value)).toEqual(['Visible text'])
  })

  it('marks string literals in JSX expression attributes for structural replacement', () => {
    const code = `const App = () => <input placeholder={'Search now'} />`
    const result = parseReactSource(code, 'src/App.tsx')

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      value: 'Search now',
      raw: "'Search now'",
      transform: 'react-jsx-attribute',
      context: 'attribute:placeholder',
    })
  })

  it('parses ordinary TypeScript angle assertions without enabling JSX', () => {
    const code = `const input = getInput(); const value = <string>input; export { value }`
    const result = parseReactSource(code, 'src/value.ts')

    expect(result.diagnostics).toEqual([])
  })

  it('records the enclosing function component scope', () => {
    const code = `export const App = () => <button>Save changes</button>`
    const result = parseReactSource(code, 'src/App.tsx')

    expect(result.candidates[0]?.component).toMatchObject({
      kind: 'react-function',
      name: 'App',
    })
  })

  it('extracts user-facing interpolated templates but not existing or technical translations', () => {
    const code = [
      "import { useTranslation } from 'react-i18next'",
      'const { t } = useTranslation()',
      'const message = `Welcome ${name}!`',
      't(`nav.home`)',
      'const endpoint = `https://${host}/api`',
    ].join('\n')
    const result = parseReactSource(code, 'src/messages.tsx')

    expect(result.candidates.map((item) => [item.value, item.transform])).toEqual([
      ['Welcome ${name}!', 'script-template'],
    ])
  })

  it('requires JSX evidence before treating an uppercase function as a component', () => {
    const code = [
      'export function FormatTitle() {',
      "  return 'Internal status'",
      '}',
      'export const View = () => <div>Visible message</div>',
    ].join('\n')
    const result = parseReactSource(code, 'src/values.tsx')

    expect(
      result.candidates.find((item) => item.value === 'Visible message')?.component?.name,
    ).toBe('View')
    expect(
      result.candidates.some((item) => item.value === 'Internal status' && item.component),
    ).toBe(false)
  })
})

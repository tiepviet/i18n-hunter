import { describe, expect, it } from 'vitest'
import { ExtractionReportSchema } from '../report-schema.js'
import { createReport } from './helpers/report-fixtures.js'

function withVueAttributeContext(context: string) {
  const report = structuredClone(createReport())
  report.findings[0]!.transform = 'vue-template-attribute'
  report.findings[0]!.context = context
  return report
}

describe('vue-template-attribute context strictness', () => {
  it.each(['attribute:foo.bar', 'foo:bar'])(
    'rejects context %s with vue-template-attribute',
    (context) => {
      const result = ExtractionReportSchema.safeParse(withVueAttributeContext(context))
      expect(result.success).toBe(false)
    },
  )

  it.each([
    'attribute:Title',
    'attribute:placeholder',
    'interpolation:string',
    'directive:v-text',
    'tag:div',
  ])('accepts context %s with vue-template-attribute', (context) => {
    const result = ExtractionReportSchema.safeParse(withVueAttributeContext(context))
    expect(result.success).toBe(true)
  })

  it('Attribute:Title follows the scoped rule preserving case', () => {
    const result = ExtractionReportSchema.safeParse(withVueAttributeContext('Attribute:Title'))
    expect(result.success).toBe(true)
  })

  it('keeps generic 2-part contexts for other transforms', () => {
    const report = structuredClone(createReport())
    report.findings[0]!.transform = 'react-jsx-text'
    report.findings[0]!.context = 'foo:bar'
    expect(ExtractionReportSchema.safeParse(report).success).toBe(true)
  })
})

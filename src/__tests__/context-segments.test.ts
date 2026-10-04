import { describe, expect, it } from 'vitest'
import { ExtractionReportSchema } from '../report-schema.js'
import { createReport } from './helpers/report-fixtures.js'

function withContext(context: string) {
  const report = structuredClone(createReport())
  report.findings[0]!.context = context
  return report
}

describe('context segments', () => {
  it.each(['attribute:foo:bar', 'attribute:..', ':::{'])('rejects context %s', (context) => {
    const result = ExtractionReportSchema.safeParse(withContext(context))
    expect(result.success).toBe(false)
  })

  it('rejects attribute:foo:bar with Invalid context segments', () => {
    const result = ExtractionReportSchema.safeParse(withContext('attribute:foo:bar'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message === 'Invalid context segments'),
      ).toBe(true)
    }
  })

  it.each(['attribute:Title', 'interpolation:string', 'directive:v-text', 'tag:div'])(
    'accepts context %s',
    (context) => {
      const result = ExtractionReportSchema.safeParse(withContext(context))
      expect(result.success).toBe(true)
    },
  )
})

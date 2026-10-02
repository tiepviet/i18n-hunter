import { z } from 'zod'
import { HunterError } from './errors.js'
import { findingCategories, transformKinds, type ExtractionReport } from './types.js'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
export const keySchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,14}$/u)
const filePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^:\0]+$/u)
  .refine(
    (value) =>
      ['.vue', '.ts', '.tsx', '.js', '.jsx'].includes(
        value.slice(value.lastIndexOf('.')).toLowerCase(),
      ),
    {
      message: 'Unsupported source extension',
    },
  )

const diagnosticPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^:]+$/u)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return (
          !['<', '>', '"', "'", '`'].includes(character) && codePoint >= 32 && codePoint !== 127
        )
      }),
    { message: 'Diagnostic path contains unsafe characters' },
  )

const componentSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  bodyStart: z.number().int().nonnegative(),
  expressionBody: z.boolean().optional(),
  expressionStart: z.number().int().nonnegative().optional(),
  expressionEnd: z.number().int().positive().optional(),
  kind: z.enum(['react-function', 'vue-script-setup', 'vue-options']),
})

export const ScanResultSchema = z
  .strictObject({
    id: z.string().min(1).max(300),
    filePath: filePathSchema,
    fileSha256: hashSchema,
    sliceSha256: hashSchema,
    valueSha256: hashSchema.optional(),
    hardcodedString: z.string().min(1).max(100_000).optional(),
    lineNumber: z.number().int().positive(),
    columnNumber: z.number().int().nonnegative(),
    endLineNumber: z.number().int().positive(),
    endColumnNumber: z.number().int().nonnegative(),
    suggestedKey: keySchema,
    context: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9:._-]+$/u),
    category: z.enum(findingCategories),
    transform: z.enum(transformKinds),
    range: z.strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    }),
    component: componentSchema.optional(),
    isNotification: z.boolean().optional(),
    notificationType: z.enum(['success', 'error', 'info', 'warning']).optional(),
  })
  .superRefine((finding, context) => {
    if (finding.range.end <= finding.range.start) {
      context.addIssue({ code: 'custom', message: 'Range end must be greater than start' })
    }
    if (finding.endLineNumber < finding.lineNumber) {
      context.addIssue({ code: 'custom', message: 'End position precedes start position' })
    }
  })

const categoryCountsSchema = z.strictObject({
  label: z.number().int().nonnegative(),
  button: z.number().int().nonnegative(),
  message: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  notification: z.number().int().nonnegative(),
})

const diagnosticCountsSchema = z.strictObject({
  error: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
})

const limitsSchema = z.strictObject({
  maxFileBytes: z.number().int().positive().max(10_000_000),
  maxFiles: z.number().int().positive().max(10_000),
  maxTotalBytes: z.number().int().positive().max(100_000_000),
  maxFindings: z.number().int().positive().max(10_000),
  maxDepth: z.number().int().positive().max(100),
})

export const DiagnosticSchema = z.strictObject({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string().regex(/^E_[A-Z0-9_]+$/u),
  message: z.string().min(1).max(2000),
  filePath: diagnosticPathSchema.optional(),
  lineNumber: z.number().int().positive().optional(),
  columnNumber: z.number().int().nonnegative().optional(),
})

export const ExtractionReportSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    generatedAt: z.iso.datetime(),
    complete: z.boolean(),
    scan: z.strictObject({
      paths: z.array(z.string().min(1).max(4096)).min(1).max(1000),
      includePatterns: z.array(z.string().min(1).max(1000)).max(100),
      excludePatterns: z.array(z.string().min(1).max(1000)).max(100),
      limits: limitsSchema,
    }),
    summary: z.strictObject({
      filesDiscovered: z.number().int().nonnegative(),
      filesScanned: z.number().int().nonnegative(),
      findings: z.number().int().nonnegative(),
      categories: categoryCountsSchema,
      diagnostics: diagnosticCountsSchema,
    }),
    findings: z.array(ScanResultSchema).max(10_000),
    diagnostics: z.array(DiagnosticSchema).max(1000),
  })
  .superRefine((report, context) => {
    const ids = new Set<string>()
    const ranges = new Set<string>()

    for (const finding of report.findings) {
      if (ids.has(finding.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate finding id: ${finding.id}` })
      }
      ids.add(finding.id)

      const rangeKey = `${finding.filePath}:${finding.range.start}:${finding.range.end}`
      if (ranges.has(rangeKey)) {
        context.addIssue({ code: 'custom', message: `Duplicate source range: ${rangeKey}` })
      }
      ranges.add(rangeKey)
    }

    if (report.summary.findings !== report.findings.length) {
      context.addIssue({ code: 'custom', message: 'Summary finding count is inconsistent' })
    }

    const categories = Object.fromEntries(
      findingCategories.map((category) => [category, 0]),
    ) as Record<(typeof findingCategories)[number], number>
    for (const finding of report.findings) categories[finding.category] += 1
    for (const category of findingCategories) {
      if (report.summary.categories[category] !== categories[category]) {
        context.addIssue({
          code: 'custom',
          message: `Summary category count is inconsistent: ${category}`,
        })
      }
    }

    const diagnostics = { error: 0, warning: 0, info: 0 }
    for (const diagnostic of report.diagnostics) diagnostics[diagnostic.severity] += 1
    const expectedComplete = diagnostics.error === 0
    if (report.complete !== expectedComplete) {
      context.addIssue({
        code: 'custom',
        message: 'Report complete flag is inconsistent with error diagnostics',
      })
    }
    for (const severity of ['error', 'warning', 'info'] as const) {
      if (report.summary.diagnostics[severity] !== diagnostics[severity]) {
        context.addIssue({
          code: 'custom',
          message: `Summary diagnostic count is inconsistent: ${severity}`,
        })
      }
    }
  })

export function parseExtractionReport(input: unknown): ExtractionReport {
  const result = ExtractionReportSchema.safeParse(input)
  if (!result.success) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `[E_REPORT_SCHEMA] ${result.error.issues.map((issue) => issue.message).join('; ')}`,
    )
  }
  return result.data
}

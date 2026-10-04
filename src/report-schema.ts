import { z } from 'zod'
import { HunterError } from './errors.js'
import { scanLimitCeilings } from './limits.js'
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
  .regex(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/\/)[^:\0]+$/u)
  .refine(
    (value) =>
      ['.vue', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(
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
  .regex(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/\/)[^:]+$/u)
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
      .regex(/^(?!.*\.\.)(?!.*:::?)(?!.*::$)(?!^:)(?!.*:$)[A-Za-z0-9:._-]+$/u),
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
    if (finding.context.includes(':')) {
      const parts = finding.context.split(':')
      const prefix = `${parts[0]}:`
      const lowerPrefix = prefix.toLowerCase()
      const scopedPrefixes = ['attribute:', 'directive:', 'tag:', 'notification:', 'variable:']
      if (scopedPrefixes.includes(lowerPrefix)) {
        const suffix = finding.context.slice(prefix.length)
        if (suffix.length === 0 || suffix.includes(':')) {
          context.addIssue({ code: 'custom', message: 'Invalid context segments' })
        }
      } else if (parts.length !== 2 || parts[0]!.length === 0 || parts[1]!.length === 0) {
        context.addIssue({ code: 'custom', message: 'Invalid context segments' })
      }
    }
    if (finding.transform === 'vue-template-attribute') {
      const ctx = finding.context
      const validAttr = /^[A-Za-z][A-Za-z0-9_-]*$/u
      const validTag = /^[a-z][a-z0-9-]*$/u
      let ok = false
      if (ctx === 'interpolation:string' || ctx === 'directive:v-text') {
        ok = true
      } else {
        const separator = ctx.indexOf(':')
        if (separator > 0) {
          const scopedPrefix = ctx.slice(0, separator + 1).toLowerCase()
          const suffix = ctx.slice(separator + 1)
          if (suffix.length > 0 && !suffix.includes(':')) {
            if (scopedPrefix === 'attribute:' && validAttr.test(suffix)) ok = true
            else if (scopedPrefix === 'tag:' && validTag.test(suffix)) ok = true
          }
        }
      }
      if (!ok) {
        context.addIssue({ code: 'custom', message: 'Invalid Vue attribute context' })
      }
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
  maxFileBytes: z.number().int().positive().max(scanLimitCeilings.maxFileBytes),
  maxFiles: z.number().int().positive().max(scanLimitCeilings.maxFiles),
  maxTotalBytes: z.number().int().positive().max(scanLimitCeilings.maxTotalBytes),
  maxFindings: z.number().int().positive().max(scanLimitCeilings.maxFindings),
  maxDepth: z.number().int().positive().max(scanLimitCeilings.maxDepth),
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
    const intervalsByFile = new Map<string, Array<{ start: number; end: number; key: string }>>()

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

      const intervals = intervalsByFile.get(finding.filePath) ?? []
      intervals.push({ start: finding.range.start, end: finding.range.end, key: rangeKey })
      intervalsByFile.set(finding.filePath, intervals)
    }

    // Linear sweep per file instead of O(n²) pairwise checks on untrusted input.
    for (const [filePath, intervals] of intervalsByFile) {
      intervals.sort((a, b) => a.start - b.start || a.end - b.end)
      for (let i = 1; i < intervals.length; i += 1) {
        const prev = intervals[i - 1]!
        const cur = intervals[i]!
        if (cur.start < prev.end && prev.start < cur.end && cur.key !== prev.key) {
          context.addIssue({
            code: 'custom',
            message: `Overlapping source ranges in ${filePath}: ${prev.key} overlaps ${cur.key}`,
          })
          break
        }
      }
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
      `[E_REPORT_SCHEMA] ${formatZodIssues(result.error.issues)}`,
    )
  }
  return result.data
}

function formatZodIssues(issues: Array<{ message: string }>): string {
  const head = issues
    .slice(0, 5)
    .map((issue) => issue.message.slice(0, 200))
    .join('; ')
  return issues.length > 5 ? `${head}; ... +${issues.length - 5} more` : head
}

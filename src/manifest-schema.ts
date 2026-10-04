import { z } from 'zod'
import { HunterError } from './errors.js'
import { scanLimitCeilings } from './limits.js'
import { validatePortableRelativePath } from './path-policy.js'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const relativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) => {
      try {
        validatePortableRelativePath(value, [])
        return true
      } catch {
        return false
      }
    },
    { message: 'Manifest paths must be portable relative paths' },
  )
const limitsSchema = z.strictObject({
  maxFileBytes: z.number().int().positive().max(scanLimitCeilings.maxFileBytes),
  maxFiles: z.number().int().positive().max(scanLimitCeilings.maxFiles),
  maxTotalBytes: z.number().int().positive().max(scanLimitCeilings.maxTotalBytes),
  maxFindings: z.number().int().positive().max(scanLimitCeilings.maxFindings),
  maxDepth: z.number().int().positive().max(scanLimitCeilings.maxDepth),
})

const transactionIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    'Invalid v4 transaction id',
  )

const entrySchema = z.strictObject({
  filePath: relativePathSchema.refine(
    (value) =>
      ['.vue', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(
        value.slice(value.lastIndexOf('.')).toLowerCase(),
      ),
    { message: 'Manifest source path has an unsupported extension' },
  ),
  backupPath: relativePathSchema,
  beforeHash: hashSchema,
  afterHash: hashSchema,
  // Restored via fchmod: world-writable/executable modes must never come from a manifest.
  // Bitmask refine (not a numeric max): only bits within the 0o644 subset pass
  // and the owner-readable bit must be set, so 0o755/0o777 are rejected at the
  // schema. Restore paths additionally sanitize via sanitizeFileMode (mask to
  // 0o644 subset) for defense-in-depth.
  mode: z
    .number()
    .int()
    .min(0)
    .refine((m) => (m & ~0o644) === 0 && (m & 0o400) !== 0, {
      message: 'Manifest file mode must be within the 0o644 subset and owner-readable',
    }),
})

export const ManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    transactionId: transactionIdSchema,
    state: z.enum(['prepared', 'applied', 'rolling_back', 'rolled_back', 'rollback_failed']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    projectRootHash: hashSchema,
    reportHash: hashSchema,
    parentTransactionId: transactionIdSchema.nullable(),
    limits: limitsSchema.optional(),
    entries: z.array(entrySchema).max(10_000),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>()
    for (const entry of manifest.entries) {
      if (entry.backupPath !== `backups/${entry.filePath}`) {
        context.addIssue({
          code: 'custom',
          message: `Backup path is not bound to source path: ${entry.filePath}`,
        })
      }
      if (seen.has(entry.filePath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate manifest entry: ${entry.filePath}`,
        })
      }
      seen.add(entry.filePath)
    }
  })

export const LatestTransactionSchema = z.strictObject({
  schemaVersion: z.literal(2),
  transactionId: transactionIdSchema,
})

export type Manifest = z.infer<typeof ManifestSchema>
export type LatestTransaction = z.infer<typeof LatestTransactionSchema>

export function parseManifest(input: unknown): Manifest {
  const result = ManifestSchema.safeParse(input)
  if (!result.success) {
    throw new HunterError(
      'E_MANIFEST_SCHEMA',
      `[E_MANIFEST_SCHEMA] ${formatZodIssues(result.error.issues)}`,
    )
  }
  return result.data
}

export function parseLatestTransaction(input: unknown): LatestTransaction {
  const result = LatestTransactionSchema.safeParse(input)
  if (!result.success) {
    throw new HunterError(
      'E_MANIFEST_SCHEMA',
      `[E_MANIFEST_SCHEMA] ${formatZodIssues(result.error.issues)}`,
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

export type HunterErrorCode =
  | 'E_APPLY_FAILED'
  | 'E_CLEAN_FAILED'
  | 'E_FILE_LIMIT'
  | 'E_INVALID_INPUT'
  | 'E_IO'
  | 'E_JSON_INVALID'
  | 'E_JSON_TOO_LARGE'
  | 'E_MANIFEST_SCHEMA'
  | 'E_PARSE_FAILED'
  | 'E_PATH_OUTSIDE_ROOT'
  | 'E_REPORT_SCHEMA'
  | 'E_ROLLBACK_FAILED'
  | 'E_SCAN_INCOMPLETE'
  | 'E_SCAN_PATH_MISSING'
  | 'E_STALE_SOURCE'
  | 'E_SYMLINK_REJECTED'
  | 'E_TRANSACTION_CONFLICT'
  | 'E_UNSUPPORTED_TRANSFORM'

export class HunterError extends Error {
  readonly code: HunterErrorCode
  readonly filePath?: string

  constructor(code: HunterErrorCode, message: string, filePath?: string) {
    super(message)
    this.name = 'HunterError'
    this.code = code
    this.filePath = filePath
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Bounded error text for user-facing output. A ZodError's `message` is a JSON
 * dump of every issue, which for a large report can be megabytes; the CLI prints
 * these straight to stderr.
 */
export function safeMessage(error: unknown, limit = 1000): string {
  const message = errorMessage(error)
  return message.length > limit ? `${message.slice(0, limit)}… (truncated)` : message
}

import { HunterError } from './errors.js'
import type { ScanLimits } from './types.js'

export const scanLimitCeilings: Readonly<ScanLimits> = Object.freeze({
  maxFileBytes: 10_000_000,
  maxFiles: 50_000,
  maxTotalBytes: 500_000_000,
  maxFindings: 50_000,
  maxDepth: 100,
})

export const defaultScanLimits: ScanLimits = {
  maxFileBytes: 2_000_000,
  maxFiles: 10_000,
  maxTotalBytes: 100_000_000,
  maxFindings: 10_000,
  maxDepth: 50,
}

export function resolveScanLimits(overrides: Partial<ScanLimits> = {}): ScanLimits {
  for (const name of Object.keys(overrides)) {
    if (!(name in scanLimitCeilings)) {
      throw new HunterError('E_FILE_LIMIT', `Invalid scan limit: ${name} (unknown limit)`)
    }
  }
  const limits = { ...defaultScanLimits, ...overrides }

  for (const [name, value] of Object.entries(limits)) {
    const ceiling = (scanLimitCeilings as Record<string, number | undefined>)[name]
    if (ceiling === undefined) {
      throw new HunterError('E_FILE_LIMIT', `Invalid scan limit: ${name} (unknown limit)`)
    }
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
      throw new HunterError('E_FILE_LIMIT', `Invalid scan limit: ${name} (maximum ${ceiling})`)
    }
  }

  return limits
}

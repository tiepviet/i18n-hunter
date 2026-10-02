import type { ScanLimits } from './types.js'

export const scanLimitCeilings: Readonly<ScanLimits> = Object.freeze({
  maxFileBytes: 10_000_000,
  maxFiles: 10_000,
  maxTotalBytes: 100_000_000,
  maxFindings: 10_000,
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
  const limits = { ...defaultScanLimits, ...overrides }

  for (const [name, value] of Object.entries(limits)) {
    const ceiling = scanLimitCeilings[name as keyof ScanLimits]
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
      throw new Error(`Invalid scan limit: ${name} (maximum ${ceiling})`)
    }
  }

  return limits
}

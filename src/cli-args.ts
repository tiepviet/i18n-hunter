export type ParsedCliArgs =
  | { kind: 'global-help' }
  | { kind: 'version' }
  | { kind: 'command-help'; command: CommandName }
  | {
      kind: 'scan'
      base: string
      scanPaths?: string[]
      output: string
      filename: string
      formats: Array<'json' | 'md'>
      includeValues: boolean
      readableKeys: boolean
      stateDir?: string
      failOn: 'error' | 'warning' | 'never'
      limits: {
        maxFileBytes?: number
        maxFiles?: number
        maxTotalBytes?: number
        maxFindings?: number
        maxDepth?: number
      }
    }
  | { kind: 'apply'; report: string; base: string; stateDir: string; dryRun: boolean }
  | { kind: 'sync'; report: string; output?: string }
  | { kind: 'rollback'; base: string; stateDir: string }
  | { kind: 'clean'; base: string; stateDir: string; yes: true }

export type CommandName = 'scan' | 'apply' | 'sync' | 'rollback' | 'clean'

const commands = new Set<CommandName>(['scan', 'apply', 'sync', 'rollback', 'clean'])

const valueOptions: Record<CommandName, Set<string>> = {
  scan: new Set([
    'base',
    'path',
    'paths',
    'output',
    'filename',
    'format',
    'fail-on',
    'max-file-size',
    'max-files',
    'max-total-bytes',
    'max-findings',
    'max-depth',
    'state-dir',
  ]),
  apply: new Set(['report', 'base', 'state-dir']),
  sync: new Set(['report', 'output']),
  rollback: new Set(['base', 'state-dir']),
  clean: new Set(['base', 'state-dir']),
}

const flagOptions: Record<CommandName, Set<string>> = {
  scan: new Set(['include-values', 'redact-values', 'readable-keys']),
  apply: new Set(['dry-run']),
  sync: new Set(),
  rollback: new Set(),
  clean: new Set(['yes']),
}

const repeatable = new Set(['path', 'paths'])

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0) return { kind: 'global-help' }
  const first = argv[0]!
  if (first === '--help' || first === '-h') return { kind: 'global-help' }
  if (first === '--version' || first === '-v') return { kind: 'version' }
  if (!commands.has(first as CommandName)) throw new Error(`Unknown command: ${first}`)

  const command = first as CommandName
  const rest = argv.slice(1)
  if (rest.includes('--help') || rest.includes('-h')) return { kind: 'command-help', command }
  const options = parseOptions(command, rest)

  switch (command) {
    case 'scan': {
      const format = options.values.format ?? 'json,md'
      const formats = validateFormats(format)
      const includeValues = validateValueExclusivity(options.flags)
      const scanPaths = [
        ...(options.values.path
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean) ?? []),
        ...(options.values.paths
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean) ?? []),
      ]
      return {
        kind: 'scan',
        base: options.values.base ?? '.',
        scanPaths: scanPaths.length > 0 ? scanPaths : undefined,
        output: options.values.output ?? 'i18n-reports',
        filename: options.values.filename ?? defaultReportFilename(),
        formats,
        includeValues,
        readableKeys: options.flags.has('readable-keys'),
        stateDir: options.values['state-dir'],
        failOn: validateFailOn(options.values['fail-on']),
        limits: {
          maxFileBytes: positiveInteger(options.values['max-file-size'], 'max-file-size'),
          maxFiles: positiveInteger(options.values['max-files'], 'max-files'),
          maxTotalBytes: positiveInteger(options.values['max-total-bytes'], 'max-total-bytes'),
          maxFindings: positiveInteger(options.values['max-findings'], 'max-findings'),
          maxDepth: positiveInteger(options.values['max-depth'], 'max-depth'),
        },
      }
    }
    case 'apply':
      requireValue(options.values.report, '--report is required for apply')
      return {
        kind: 'apply',
        report: options.values.report!,
        base: options.values.base ?? '.',
        stateDir: options.values['state-dir'] ?? '.i18n-hunter',
        dryRun: options.flags.has('dry-run'),
      }
    case 'sync':
      requireValue(options.values.report, '--report is required for sync')
      return { kind: 'sync', report: options.values.report!, output: options.values.output }
    case 'rollback':
      return {
        kind: 'rollback',
        base: options.values.base ?? '.',
        stateDir: options.values['state-dir'] ?? '.i18n-hunter',
      }
    case 'clean':
      if (!options.flags.has('yes')) throw new Error('--yes is required for clean')
      return {
        kind: 'clean',
        base: options.values.base ?? '.',
        stateDir: options.values['state-dir'] ?? '.i18n-hunter',
        yes: true,
      }
  }
}

function parseOptions(
  command: CommandName,
  args: string[],
): { values: Record<string, string | undefined>; flags: Set<string> } {
  const values: Record<string, string | undefined> = {}
  const flags = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument: ${argument}`)
    const equalsIndex = argument.indexOf('=')
    const name = argument.slice(2, equalsIndex >= 0 ? equalsIndex : undefined)
    const inlineValue = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined

    if (flagOptions[command].has(name)) {
      if (inlineValue !== undefined) throw new Error(`--${name} does not accept a value`)
      flags.add(name)
      continue
    }
    if (!valueOptions[command].has(name))
      throw new Error(`Unknown option for ${command}: --${name}`)
    if (!repeatable.has(name) && values[name] !== undefined)
      throw new Error(`Duplicate option: --${name}`)
    const value = inlineValue ?? args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`)
    if (inlineValue === undefined) index += 1
    if (name === 'path') {
      const existing = values.path?.split(',').filter(Boolean) ?? []
      values.path = [
        ...existing,
        ...value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ].join(',')
    } else {
      values[name] = value
    }
  }
  return { values, flags }
}

function validateFormats(value: string): Array<'json' | 'md'> {
  const formats = value.split(',').map((item) => item.trim())
  if (formats.some((format) => format !== 'json' && format !== 'md')) {
    throw new Error(`Unsupported format: ${value}`)
  }
  return [...new Set(formats)] as Array<'json' | 'md'>
}

function validateValueExclusivity(flags: Set<string>): boolean {
  if (flags.has('include-values') && flags.has('redact-values')) {
    throw new Error('--include-values and --redact-values are mutually exclusive')
  }
  return flags.has('include-values')
}

function validateFailOn(value: string | undefined): 'error' | 'warning' | 'never' {
  const normalized = value ?? 'error'
  if (normalized !== 'error' && normalized !== 'warning' && normalized !== 'never') {
    throw new Error(`Invalid --fail-on value: ${value}`)
  }
  return normalized
}

function positiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`--${name} must be a positive integer`)
  return parsed
}

function requireValue(value: string | undefined, message: string): void {
  if (!value) throw new Error(message)
}

function defaultReportFilename(): string {
  return `i18n-hunt-report-${new Date()
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z')
    .replace('T', '-')}`
}

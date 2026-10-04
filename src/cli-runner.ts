import { relative, resolve } from 'node:path'
import { applyReport, cleanTransactions, rollbackTransactions } from './applier.js'
import { parseCliArgs, type ParsedCliArgs } from './cli-args.js'
import { HunterError, safeMessage } from './errors.js'
import { exportReport, generateSummary } from './report-formatter.js'
import { scanForHardcodedStrings } from './scanner.js'
import { syncReportMd } from './sync-report.js'
import { packageVersion } from './version.js'

export interface CliIo {
  cwd(): string
  stdout(value: string): void
  stderr(value: string): void
}

const globalHelp = `i18n-hunter — AST-based Vue/React localization scanner

Usage:
  i18n-hunter <command> [options]

Commands:
  scan       Find hardcoded user-facing strings
  apply      Apply a reviewed v2 JSON report transactionally
  sync       Regenerate Markdown from a v2 JSON report
  rollback   Restore the active transaction chain
  clean      Remove managed transaction state

Global options:
  --help      Show global help
  --version   Show the installed version

Run "i18n-hunter <command> --help" for command-specific help.`

const commandHelp: Record<string, string> = {
  scan: `i18n-hunter scan — Find hardcoded user-facing strings

Usage:
  i18n-hunter scan [options]

Options:
  --base <dir>                 Project root (default: current directory)
  --path <path>                File/directory to scan; repeatable
  --paths <a,b>                Comma-separated scan paths (repeatable, accumulates)
  --output <dir>               Report directory (default: i18n-reports)
  --filename <name>            Report basename without extension
  --format <json|md|json,md>   Output format (default: json,md)
  --include-values             Include source values in reports (off by default)
  --redact-values              Explicitly redact source values (default)
  --readable-keys              Opt in to value-derived readable key segments
  --state-dir <dir>            Managed state directory excluded from scan
  --fail-on <error|warning|never>
  --max-file-size <bytes>
  --max-files <count>
  --max-total-bytes <bytes>
  --max-findings <count>
  --max-depth <count>`,
  apply: `i18n-hunter apply — Apply reviewed findings

Usage:
  i18n-hunter apply --report <report.json> [options]

Options:
  --base <dir>          Project root (default: current directory)
  --state-dir <dir>     Managed transaction state (default: .i18n-hunter)
  --dry-run             Print unified diffs without writing`,
  sync: `i18n-hunter sync — Regenerate Markdown from JSON

Usage:
  i18n-hunter sync --report <report.json> [--output <report.md>]`,
  rollback: `i18n-hunter rollback — Restore the active transaction chain

Usage:
  i18n-hunter rollback [--base <dir>] [--state-dir <dir>]`,
  clean: `i18n-hunter clean — Remove managed transaction state

Usage:
  i18n-hunter clean --yes [--base <dir>] [--state-dir <dir>]`,
}

/**
 * User-facing error rendering: preserve the machine-readable HunterError code
 * and bound the message (safeMessage truncates to 1000 chars) so a large
 * ZodError dump can never flood stderr unbounded.
 */
function formatCliError(error: unknown): string {
  if (error instanceof HunterError) return `[i18n-hunter] ${error.code}: ${safeMessage(error)}\n`
  return `[i18n-hunter] ${safeMessage(error)}\n`
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args: ParsedCliArgs
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    io.stderr(formatCliError(error))
    return 1
  }

  try {
    switch (args.kind) {
      case 'global-help':
        io.stdout(`${globalHelp}\n`)
        return 0
      case 'version':
        io.stdout(`${packageVersion()}\n`)
        return 0
      case 'command-help':
        io.stdout(`${commandHelp[args.command]}\n`)
        return 0
      case 'scan':
        return await runScan(args, io)
      case 'apply':
        return await runApply(args, io)
      case 'sync':
        return await runSync(args, io)
      case 'rollback':
        return await runRollback(args, io)
      case 'clean':
        return await runClean(args, io)
    }
  } catch (error) {
    io.stderr(formatCliError(error))
    return 1
  }
}

async function runScan(args: Extract<ParsedCliArgs, { kind: 'scan' }>, io: CliIo): Promise<number> {
  const cwd = io.cwd()
  const basePath = resolve(cwd, args.base)
  const outputDir = resolve(cwd, args.output)
  // A custom `--output` directory is not covered by the default
  // `**/i18n-reports/**` exclusion: exclude it explicitly so future scans never
  // ingest prior reports.
  const outputRelative = relative(basePath, outputDir).replace(/\\/gu, '/')
  const extraExcludes =
    outputRelative && !outputRelative.startsWith('..') && outputRelative !== ''
      ? [`${outputRelative}/**`]
      : []
  const report = await scanForHardcodedStrings(
    {
      ...(args.scanPaths ? { scanPaths: args.scanPaths } : {}),
      includeValues: args.includeValues,
      readableKeys: args.readableKeys,
      ...(args.stateDir ? { stateDir: args.stateDir } : {}),
      ...(extraExcludes.length > 0 ? { excludePatterns: extraExcludes } : {}),
      limits: args.limits,
    },
    basePath,
  )
  const created = exportReport(report, {
    outputDir,
    filename: args.filename,
    json: args.formats.includes('json'),
    markdown: args.formats.includes('md'),
  })

  io.stdout(`${generateSummary(report)}\n\nReports created:\n`)
  for (const path of created) io.stdout(`  ${path}\n`)
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.filePath
      ? ` ${diagnostic.filePath}${diagnostic.lineNumber ? `:${diagnostic.lineNumber}` : ''}${diagnostic.columnNumber !== undefined ? `:${diagnostic.columnNumber}` : ''}`
      : ''
    io.stderr(
      `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${location}: ${diagnostic.message}\n`,
    )
  }

  if (args.failOn === 'never') return 0
  if (args.failOn === 'warning' && report.diagnostics.some((item) => item.severity !== 'info'))
    return 2
  if (args.failOn === 'error' && report.diagnostics.some((item) => item.severity === 'error'))
    return 2
  return 0
}

async function runApply(
  args: Extract<ParsedCliArgs, { kind: 'apply' }>,
  io: CliIo,
): Promise<number> {
  const cwd = io.cwd()
  const result = await applyReport(resolve(cwd, args.report), {
    basePath: resolve(cwd, args.base),
    stateDir: args.stateDir,
    dryRun: args.dryRun,
  })
  io.stdout(`${args.dryRun ? 'Dry run: ' : 'Applied: '}${result.modifiedFiles.length} file(s)\n`)
  for (const diff of result.diffs) io.stdout(`${diff}\n`)
  if (result.transactionId) io.stdout(`Transaction: ${result.transactionId}\n`)
  return 0
}

async function runSync(args: Extract<ParsedCliArgs, { kind: 'sync' }>, io: CliIo): Promise<number> {
  const cwd = io.cwd()
  const result = syncReportMd(
    resolve(cwd, args.report),
    args.output ? resolve(cwd, args.output) : undefined,
  )
  io.stdout(`Synced ${result.findingsRendered} finding(s): ${result.mdPath}\n`)
  return 0
}

async function runRollback(
  args: Extract<ParsedCliArgs, { kind: 'rollback' }>,
  io: CliIo,
): Promise<number> {
  const cwd = io.cwd()
  const result = await rollbackTransactions({
    basePath: resolve(cwd, args.base),
    stateDir: args.stateDir,
  })
  io.stdout(
    `Rolled back ${result.transactionIds.length} transaction(s), ${result.restoredFiles.length} file(s).\n`,
  )
  return 0
}

async function runClean(
  args: Extract<ParsedCliArgs, { kind: 'clean' }>,
  io: CliIo,
): Promise<number> {
  const cwd = io.cwd()
  const result = await cleanTransactions({
    basePath: resolve(cwd, args.base),
    stateDir: args.stateDir,
  })
  io.stdout(`Removed ${result.removedTransactions} managed transaction(s).\n`)
  return 0
}

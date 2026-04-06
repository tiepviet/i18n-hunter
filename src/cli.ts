/**
 * i18n-hunter CLI
 *
 * COMMANDS
 *   scan      Hunt for hardcoded strings and produce a report
 *   apply     Apply suggested keys from a JSON report to source files
 *   rollback  Undo the last apply using the backup manifest
 *   sync      Re-generate the Markdown report from an edited JSON report
 *
 * Run `i18n-hunter --help` or `i18n-hunter <command> --help` for details.
 */

import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { scanForHardcodedStrings } from './scanner.js'
import { exportReport, generateSummary } from './report-formatter.js'
import { applyReport, rollbackFromManifest, cleanBackups } from './applier.js'
import { syncReportMd } from './sync-report.js'

// ─────────────────────────────────────────────
// Argument helpers
// ─────────────────────────────────────────────

const rawArgs = process.argv.slice(2)
const command = rawArgs[0]
const args = rawArgs.slice(1)

function flag(name: string): string | undefined {
  const i = args.findIndex((a) => a === `--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const prefix = `--${name}=`
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

// ─────────────────────────────────────────────
// Global help
// ─────────────────────────────────────────────

const GLOBAL_HELP = `
i18n-hunter — The Global i18n Hunter 🏹

USAGE
  i18n-hunter <command> [options]

COMMANDS
  scan      Hunt for hardcoded strings (outputs JSON + MD reports)
  apply     Apply keys from a JSON report to your source files
  rollback  Restore files to their state before the last apply
  sync      Re-generate the Markdown report from an edited JSON report
  clean     Delete .bak files and manifest after a confirmed apply

OPTIONS (global)
  --help    Show this help

Run \`i18n-hunter <command> --help\` for command-specific options.

WORKFLOW EXAMPLE
  1. i18n-hunter scan --paths src
  2. # Review / edit suggestedKey values in i18n-reports/*.json
  3. i18n-hunter apply --report i18n-reports/i18n-hunt-report-2026-04-06.json
  4. # If something went wrong:
     i18n-hunter rollback
  5. # Happy with the result? Clean up backups:
     i18n-hunter clean
  6. # After editing JSON, sync the Markdown:
     i18n-hunter sync --report i18n-reports/i18n-hunt-report-2026-04-06.json
`

if (!command || hasFlag('help') || command === '--help' || command === '-h') {
  console.log(GLOBAL_HELP)
  process.exit(0)
}

// ─────────────────────────────────────────────
// COMMAND: scan
// ─────────────────────────────────────────────

if (command === 'scan') {
  if (hasFlag('help')) {
    console.log(`
i18n-hunter scan — Hunt hardcoded strings

USAGE
  i18n-hunter scan [options]

OPTIONS
  --paths   <dirs>   Comma-separated directories or files to scan
  --output  <dir>    Output directory for reports       (default: ./i18n-reports)
  --format  <fmts>   Output formats: json, md           (default: json,md)
  --base    <dir>    Project root / base path            (default: cwd)
  --help             Show this help
`)
    process.exit(0)
  }

  const basePath = flag('base') ?? process.cwd()
  const rawPaths = flag('paths')
  const scanPaths = rawPaths ? rawPaths.split(',').map((p) => p.trim()) : undefined
  const outputDir = flag('output') ?? './i18n-reports'
  const formats = (flag('format') ?? 'json,md').split(',').map((f) => f.trim())
  const exportJson = formats.includes('json')
  const exportMd = formats.includes('md') || formats.includes('markdown')

  console.log('i18n-hunter — The Global i18n Hunter 🏹')
  console.log('─'.repeat(40))
  console.log(`Base path:    ${basePath}`)
  console.log(`Output:       ${outputDir}`)
  console.log(`Formats:      ${formats.join(', ')}`)
  if (scanPaths) console.log(`Scan paths:   ${scanPaths.join(', ')}`)
  console.log('')

  const report = scanForHardcodedStrings(scanPaths ? { scanPaths } : {}, basePath)

  console.log('')
  console.log(generateSummary(report))
  console.log('')

  if (report.totalStrings > 0) {
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = `i18n-hunt-report-${timestamp}`

    const created = exportReport(report, {
      outputDir,
      filename,
      json: exportJson,
      markdown: exportMd,
    })

    console.log('')
    console.log('Reports created:')
    for (const f of created) console.log(`  ${f}`)
  } else {
    console.log('No hardcoded strings found — project looks clean! 🎉')
  }

  console.log('')
  console.log('Done.')
}

// ─────────────────────────────────────────────
// COMMAND: apply
// ─────────────────────────────────────────────

else if (command === 'apply') {
  if (hasFlag('help')) {
    console.log(`
i18n-hunter apply — Apply i18n keys to source files

USAGE
  i18n-hunter apply --report <path> [options]

DESCRIPTION
  Reads the given JSON report (which may have been manually edited to correct
  suggestedKeys), then replaces each hardcoded string in the source files with
  the appropriate i18n call:

    Vue  :  {{ $t('key') }}  /  $t('key')  /  t('key')
    React:  {t('key')}       /  t('key')   (via react-i18next)

  Automatically injects the necessary import and hook (useI18n / useTranslation)
  if they are not already present in the file.

  A backup of each modified file is saved next to it as <file>.i18n-hunter.bak,
  and a manifest is written to the --output directory for use by 'rollback'.

OPTIONS
  --report  <file>   Path to the JSON report file           (required)
  --base    <dir>    Project root used to resolve file paths (default: cwd)
  --output  <dir>    Directory for the rollback manifest    (default: ./i18n-reports)
  --dry-run          Preview changes without writing files
  --help             Show this help
`)
    process.exit(0)
  }

  const reportPath = flag('report')
  if (!reportPath) {
    console.error('[i18n-hunter] Error: --report <path> is required for apply.')
    process.exit(1)
  }

  const basePath = flag('base') ?? process.cwd()
  const outputDir = flag('output') ?? './i18n-reports'
  const dryRun = hasFlag('dry-run')

  console.log('i18n-hunter — Apply 🖊')
  console.log('─'.repeat(40))
  console.log(`Report:       ${reportPath}`)
  console.log(`Base path:    ${basePath}`)
  if (dryRun) console.log('Mode:         DRY RUN (no files will be written)')
  console.log('')

  try {
    const result = applyReport(reportPath, { basePath, outputDir, dryRun })

    console.log('')
    console.log(`Modified files (${result.modifiedFiles.length}):`)
    for (const f of result.modifiedFiles) console.log(`  ✅ ${f}`)

    if (result.skipped.length) {
      console.log(`\nSkipped (${result.skipped.length}):`)
      for (const f of result.skipped) console.log(`  ⏭  ${f}`)
    }

    if (result.warnings.length) {
      console.log(`\nWarnings (${result.warnings.length}):`)
      for (const w of result.warnings) console.log(`  ⚠️  ${w}`)
    }

    if (!dryRun && result.modifiedFiles.length > 0) {
      console.log(`\nManifest: ${result.manifestPath}`)
      console.log('Run `i18n-hunter rollback` to undo these changes.')
    }
  } catch (err) {
    console.error(`[i18n-hunter] Apply failed: ${String(err)}`)
    process.exit(1)
  }

  console.log('\nDone.')
}

// ─────────────────────────────────────────────
// COMMAND: rollback
// ─────────────────────────────────────────────

else if (command === 'rollback') {
  if (hasFlag('help')) {
    console.log(`
i18n-hunter rollback — Restore files from the last apply

USAGE
  i18n-hunter rollback [options]

OPTIONS
  --output  <dir>   Directory containing the manifest   (default: ./i18n-reports)
  --help            Show this help
`)
    process.exit(0)
  }

  const outputDir = flag('output') ?? './i18n-reports'
  const manifestPath = join(outputDir, '.i18n-hunter-manifest.json')

  console.log('i18n-hunter — Rollback ↩️')
  console.log('─'.repeat(40))
  console.log(`Manifest:     ${manifestPath}`)
  console.log('')

  try {
    const result = rollbackFromManifest(manifestPath)

    console.log(`\nRestored (${result.restored.length}):`)
    for (const f of result.restored) console.log(`  ↩️  ${f}`)

    if (result.errors.length) {
      console.log(`\nErrors (${result.errors.length}):`)
      for (const e of result.errors) console.log(`  ❌ ${e}`)
    }
  } catch (err) {
    console.error(`[i18n-hunter] Rollback failed: ${String(err)}`)
    process.exit(1)
  }

  console.log('\nDone.')
}

// ─────────────────────────────────────────────
// COMMAND: clean
// ─────────────────────────────────────────────

else if (command === 'clean') {
  if (hasFlag('help')) {
    console.log(`
i18n-hunter clean — Delete backups after a confirmed apply

USAGE
  i18n-hunter clean [options]

DESCRIPTION
  Removes all .i18n-hunter.bak files and the manifest created by 'apply'.
  Run this only after verifying that the applied changes look correct.
  Once cleaned, rollback is no longer possible.

OPTIONS
  --output  <dir>   Directory containing the manifest   (default: ./i18n-reports)
  --help            Show this help
`)
    process.exit(0)
  }

  const outputDir = flag('output') ?? './i18n-reports'
  const manifestPath = join(outputDir, '.i18n-hunter-manifest.json')

  console.log('i18n-hunter — Clean 🧹')
  console.log('─'.repeat(40))
  console.log(`Manifest:     ${manifestPath}`)
  console.log('')

  try {
    const result = cleanBackups(manifestPath)

    console.log(`\nRemoved (${result.deleted.length}):`)
    for (const f of result.deleted) console.log(`  🗑  ${f}`)

    if (result.errors.length) {
      console.log(`\nErrors (${result.errors.length}):`)
      for (const e of result.errors) console.log(`  ❌ ${e}`)
    }
  } catch (err) {
    console.error(`[i18n-hunter] Clean failed: ${String(err)}`)
    process.exit(1)
  }

  console.log('\nDone. Rollback is no longer available for this apply.')
}

// ─────────────────────────────────────────────
// COMMAND: sync
// ─────────────────────────────────────────────

else if (command === 'sync') {
  if (hasFlag('help')) {
    console.log(`
i18n-hunter sync — Re-generate Markdown from an edited JSON report

USAGE
  i18n-hunter sync --report <path>

DESCRIPTION
  After manually editing suggestedKeys in the JSON report, run this command
  to regenerate the .md report so both files stay in sync.

OPTIONS
  --report  <file>   Path to the JSON report file  (required)
  --help             Show this help
`)
    process.exit(0)
  }

  const reportPath = flag('report')
  if (!reportPath) {
    console.error('[i18n-hunter] Error: --report <path> is required for sync.')
    process.exit(1)
  }

  console.log('i18n-hunter — Sync 🔄')
  console.log('─'.repeat(40))
  console.log(`Report:       ${reportPath}`)
  console.log('')

  try {
    const result = syncReportMd(reportPath)
    console.log(`✅ Synced ${result.keysUpdated} entries`)
    console.log(`   JSON: ${result.jsonPath}`)
    console.log(`   MD:   ${result.mdPath}`)
  } catch (err) {
    console.error(`[i18n-hunter] Sync failed: ${String(err)}`)
    process.exit(1)
  }

  console.log('\nDone.')
}

// ─────────────────────────────────────────────
// Unknown command
// ─────────────────────────────────────────────

else {
  console.error(`[i18n-hunter] Unknown command: "${command}"`)
  console.error('Run `i18n-hunter --help` for usage.')
  process.exit(1)
}

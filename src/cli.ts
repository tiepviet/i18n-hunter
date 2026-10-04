import { runCli } from './cli-runner.js'
import { safeMessage } from './errors.js'

let interrupted = false
const handleSignal = (): void => {
  interrupted = true
}
process.once('SIGINT', handleSignal)
process.once('SIGTERM', handleSignal)

function cleanupSignals(): void {
  process.removeListener('SIGINT', handleSignal)
  process.removeListener('SIGTERM', handleSignal)
}

function getExitCode(exitCode: number): number {
  return interrupted ? 130 : exitCode
}

// runCli already maps operational errors to exit codes, but a rejection here
// (e.g. stdout/stderr throwing, or an unexpected bug) would otherwise become
// an unhandled promise rejection with no output. Catch it so the CLI always
// reports to stderr and exits non-zero.
void runCli(process.argv.slice(2), {
  cwd: () => process.cwd(),
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
})
  .then((exitCode) => {
    cleanupSignals()
    process.exitCode = getExitCode(exitCode)
  })
  .catch((error: unknown) => {
    cleanupSignals()
    process.stderr.write(`[i18n-hunter] ${safeMessage(error)}\n`)
    process.exitCode = 1
  })

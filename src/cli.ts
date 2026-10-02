import { runCli } from './cli-runner.js'

let interrupted = false
const handleSignal = (): void => {
  interrupted = true
}
process.once('SIGINT', handleSignal)
process.once('SIGTERM', handleSignal)

void runCli(process.argv.slice(2), {
  cwd: () => process.cwd(),
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
}).then((exitCode) => {
  process.removeListener('SIGINT', handleSignal)
  process.removeListener('SIGTERM', handleSignal)
  process.exitCode = interrupted ? 130 : exitCode
})

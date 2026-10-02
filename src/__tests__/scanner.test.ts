import { afterEach, describe, expect, it } from 'vitest'
import { scanForHardcodedStrings } from '../scanner.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('scanForHardcodedStrings', () => {
  it('bounds opaque keys for deeply nested source paths', async () => {
    project = createTempProject()
    const path = `${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(60)}/App.tsx`
    project.write(`src/${path}`, 'export const App = () => <div>Long path message</div>')

    const report = await scanForHardcodedStrings({}, project.root)

    expect(report.findings[0]?.suggestedKey.length).toBeLessThanOrEqual(200)
    expect(report.findings[0]?.valueSha256).toBeUndefined()
  })

  it('uses opaque source-derived values by default', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Secret customer label</div>')

    const redacted = await scanForHardcodedStrings({}, project.root)
    const readable = await scanForHardcodedStrings(
      { includeValues: true, readableKeys: true },
      project.root,
    )

    expect(redacted.findings[0]?.suggestedKey).not.toContain('secret_customer_label')
    expect(readable.findings[0]?.suggestedKey).toContain('secret_customer_label')
  })

  it('returns a canonical report without console output', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello scanner</div>')

    const report = await scanForHardcodedStrings({}, project.root)

    expect(report.schemaVersion).toBe(2)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.hardcodedString).toBeUndefined()
  })
})

import { parseJavaScriptSource } from './javascript-extractor.js'
import type { ExtractedCandidate, ParseResult } from './types.js'

export type { ExtractedCandidate }

export function parseReactSource(content: string, filePath: string): ParseResult {
  const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
  const jsx = ['.js', '.jsx', '.tsx'].some((extension) => filePath.endsWith(extension))

  return parseJavaScriptSource({
    content,
    fullSource: content,
    filePath,
    typescript: isTypeScript,
    jsx,
    componentMode: 'react',
  })
}

export function parseReactComponent(content: string, filePath: string): ExtractedCandidate[] {
  return parseReactSource(content, filePath).candidates
}

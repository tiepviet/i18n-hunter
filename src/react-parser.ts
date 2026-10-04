import { parseJavaScriptSource } from './javascript-extractor.js'
import { isJsxSourcePath, isTypeScriptSourcePath } from './path-policy.js'
import type { ExtractedCandidate, ParseResult } from './types.js'

export type { ExtractedCandidate }

export function parseReactSource(content: string, filePath: string): ParseResult {
  return parseJavaScriptSource({
    content,
    fullSource: content,
    filePath,
    typescript: isTypeScriptSourcePath(filePath),
    jsx: isJsxSourcePath(filePath),
    componentMode: 'react',
  })
}

export function parseReactComponent(content: string, filePath: string): ExtractedCandidate[] {
  return parseReactSource(content, filePath).candidates
}

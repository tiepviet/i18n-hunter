import traverseModule from '@babel/traverse'
import generateModule from '@babel/generator'

type TraverseFunction = typeof traverseModule
type GenerateFunction = typeof generateModule

export const traverse: TraverseFunction =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: TraverseFunction }).default

export const generate: GenerateFunction =
  typeof generateModule === 'function'
    ? generateModule
    : (generateModule as unknown as { default: GenerateFunction }).default

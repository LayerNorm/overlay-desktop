import { describe, expect, it } from 'vitest'
import { buildNativeProjectFileTree } from './native-file-tree'

describe('buildNativeProjectFileTree', () => {
  it('native project paths use the shared sorted tree contract', () => {
    const tree = buildNativeProjectFileTree([
      './src/zeta.ts',
      'README.md',
      'src/components/Button.tsx',
      'src/alpha.ts',
    ])
    expect(tree.map((node) => [node.name, node.type])).toEqual([
      ['src', 'directory'],
      ['README.md', 'file'],
    ])
    expect(tree[0]?.children.map((node) => node.name)).toEqual([
      'components',
      'alpha.ts',
      'zeta.ts',
    ])
    expect(tree[0]?.children[0]?.children[0]?.relativePath).toBe('src/components/Button.tsx')
  })
})

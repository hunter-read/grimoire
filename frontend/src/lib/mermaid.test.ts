import { beforeEach, describe, expect, it, vi } from 'vitest'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({ default: mermaid }))

import { mermaidTheme, renderMermaid } from './mermaid'

beforeEach(() => {
  vi.clearAllMocks()
  mermaid.parse.mockResolvedValue({ diagramType: 'flowchart-v2' })
  mermaid.render.mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart-v2' })
})

describe('mermaidTheme', () => {
  it('maps light to the default theme and everything else to dark', () => {
    expect(mermaidTheme('light')).toBe('default')
    expect(mermaidTheme('dark')).toBe('dark')
    expect(mermaidTheme(null)).toBe('dark')
  })
})

describe('renderMermaid', () => {
  it('renders under the strict security level in the given theme', async () => {
    await expect(renderMermaid('m1', 'flowchart LR\n A-->B', 'default')).resolves.toBe(
      '<svg></svg>'
    )
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })
    expect(mermaid.render).toHaveBeenCalledWith('m1', 'flowchart LR\n A-->B')
  })

  it('stops at a parse error, before render touches the DOM', async () => {
    mermaid.parse.mockRejectedValue(new Error('Parse error'))
    await expect(renderMermaid('m2', 'nonsense', 'dark')).rejects.toThrow('Parse error')
    expect(mermaid.render).not.toHaveBeenCalled()
  })
})

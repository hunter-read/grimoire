import { beforeEach, describe, expect, it, vi } from 'vitest'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({ default: mermaid }))

import { mermaidTheme, renderMermaid, tidyDiagram } from './mermaid'

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
  it('renders under the strict security level, labels as text, in the given theme', async () => {
    await expect(renderMermaid('m1', 'flowchart LR\n A-->B', 'default')).resolves.toBe(
      '<svg></svg>'
    )
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'default',
      })
    )
    // A diagram's own config can't undo that, nor Mermaid's defaults.
    const { secure } = mermaid.initialize.mock.calls[0][0] as { secure: string[] }
    expect(secure).toEqual(
      expect.arrayContaining(['secure', 'securityLevel', 'maxTextSize', 'htmlLabels', 'themeCSS'])
    )
    expect(mermaid.render).toHaveBeenCalledWith('m1', 'flowchart LR\n A-->B')
  })

  it('stops at a parse error, before render touches the DOM', async () => {
    mermaid.parse.mockRejectedValue(new Error('Parse error'))
    await expect(renderMermaid('m2', 'nonsense', 'dark')).rejects.toThrow('Parse error')
    expect(mermaid.render).not.toHaveBeenCalled()
  })
})

const parse = (svg: string) => {
  const t = document.createElement('template')
  t.innerHTML = svg
  return t.content
}

const linked = (href: string) =>
  `<svg><a xlink:href="${href}" target="_self" transform="translate(1, 2)"><g><text>Node</text></g></a></svg>`

describe('tidyDiagram', () => {
  it('opens a web address in a new tab, with no opener or referrer', () => {
    const a = parse(tidyDiagram(linked('https://example.com/lore'))).querySelector('a')!
    expect(a.getAttribute('xlink:href')).toBe('https://example.com/lore')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('leaves a path inside the app opening in place', () => {
    const a = parse(tidyDiagram(linked('/campaigns/abc'))).querySelector('a')!
    expect(a.getAttribute('xlink:href')).toBe('/campaigns/abc')
    expect(a.getAttribute('target')).toBeNull()
    expect(a.getAttribute('rel')).toBeNull()
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    '//other.example/x',
    '/\\other.example',
    'about:blank',
    '',
  ])('turns %j into plain text, keeping the node where it was', (href) => {
    const a = parse(tidyDiagram(linked(href))).querySelector('a')!
    expect(a.hasAttribute('xlink:href')).toBe(false)
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.getAttribute('target')).toBeNull()
    expect(a.getAttribute('transform')).toBe('translate(1, 2)')
    expect(a.textContent).toBe('Node')
  })

  it('reads a plain href as well as xlink:href', () => {
    const a = parse(tidyDiagram('<svg><a href="http://example.com">x</a></svg>')).querySelector(
      'a'
    )!
    expect(a.getAttribute('target')).toBe('_blank')
  })

  it('drops HTML labels, form fields and frames, and keeps the rest of the drawing', () => {
    const svg =
      '<svg><g class="node"><rect></rect><switch><foreignObject><div><span>Label</span>' +
      '<form action="/x"><input name="pw"><button>Go</button></form>' +
      '</div></foreignObject><text>Label</text></switch><iframe></iframe></g></svg>'
    const out = parse(tidyDiagram(svg))
    expect(out.querySelector('foreignObject, div, form, input, button, iframe')).toBeNull()
    expect(out.querySelector('rect')).not.toBeNull()
    expect(out.querySelector('switch > text')?.textContent).toBe('Label')
  })

  it('passes renderMermaid output through it', async () => {
    mermaid.render.mockResolvedValue({
      svg: linked('javascript:alert(1)'),
      diagramType: 'flowchart-v2',
    })
    const out = parse(await renderMermaid('m3', 'flowchart LR\n A-->B', 'dark'))
    expect(out.querySelector('a')!.hasAttribute('xlink:href')).toBe(false)
  })
})

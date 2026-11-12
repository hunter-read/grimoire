import { beforeAll, describe, expect, it } from 'vitest'
import { renderMermaid } from './mermaid'

// Real Mermaid (mermaid.test.ts mocks it): what a diagram's own config can and
// can't change. jsdom has no layout, so give SVG elements a box to measure.
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>
  proto.getBBox ??= () => ({ x: 0, y: 0, width: 40, height: 16 })
  proto.getComputedTextLength ??= () => 40
})

const LABEL = '<b style="color:red">Bold</b>'
let n = 0
const render = (source: string) => renderMermaid(`real-${++n}`, source, 'dark')

describe('renderMermaid with real Mermaid', () => {
  it.each([
    ['plain', `flowchart LR\n  A["${LABEL}"] --> B`],
    ['an init directive', `%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  A["${LABEL}"] --> B`],
    [
      'a flowchart init directive',
      `%%{init: {"flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n  A["${LABEL}"] --> B`,
    ],
    [
      'config frontmatter',
      `---\nconfig:\n  htmlLabels: true\n  flowchart:\n    htmlLabels: true\n---\nflowchart LR\n  A["${LABEL}"] --> B`,
    ],
  ])('keeps labels as SVG text for %s', async (_, source) => {
    const t = document.createElement('template')
    t.innerHTML = await render(source)
    const out = t.content
    expect(out.querySelector('foreignObject, b, div, span')).toBeNull()
    expect(out.querySelector('text')?.textContent).toContain('Bold')
  })

  it('keeps a journey task readable once its HTML copy is dropped', async () => {
    const t = document.createElement('template')
    t.innerHTML = await render('journey\n  title Day\n  section Work\n    Make tea: 5: Me')
    expect(t.content.querySelector('foreignObject')).toBeNull()
    const texts = [...t.content.querySelectorAll('text')].map((el) => el.textContent)
    expect(texts).toContain('Make tea')
  })
})

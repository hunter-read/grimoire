import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiMarkdown, { prefetchedBookEmbeds } from './WikiMarkdown'
import { renderMermaid } from '../../lib/mermaid'

vi.mock('../../lib/mermaid', () => ({
  mermaidTheme: (mode: string | null) => (mode === 'light' ? 'default' : 'dark'),
  renderMermaid: vi.fn(),
}))
const mockRender = vi.mocked(renderMermaid)

function renderMd(props: ComponentProps<typeof WikiMarkdown>) {
  return render(
    <MemoryRouter>
      <WikiMarkdown {...props} />
    </MemoryRouter>
  )
}

const FLOW = 'flowchart LR\n  Tavern[[Sewers]] --> Lair'

beforeEach(() => {
  mockRender.mockReset()
  mockRender.mockResolvedValue('<svg data-testid="diagram"><text>ok</text></svg>')
})

describe('WikiMarkdown fenced code', () => {
  it('renders a mermaid fence as a diagram from its exact source', async () => {
    renderMd({ body: `Intro\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n` })
    expect(await screen.findByTestId('diagram')).toBeInTheDocument()
    // `[[Sewers]]` is a Mermaid node shape, not a wiki link.
    expect(mockRender).toHaveBeenCalledWith(expect.any(String), FLOW, 'dark')
    expect(screen.queryByRole('button', { name: /Sewers/ })).toBeNull()
  })

  it('matches the language case-insensitively', async () => {
    renderMd({ body: `\`\`\`Mermaid\n${FLOW}\n\`\`\`` })
    expect(await screen.findByTestId('diagram')).toBeInTheDocument()
  })

  it('renders every other fence as one plain code block, unchanged', () => {
    const { container } = renderMd({
      body: '```js\nconst a = [[1]] || b\n```\n\n~~~\nplain\n~~~\n\n```\nno language\n```',
    })
    const pres = container.querySelectorAll('pre')
    expect(pres).toHaveLength(3)
    // No <pre> inside a <pre>, and the <code> carries no styling of its own.
    expect(container.querySelector('pre pre')).toBeNull()
    expect(pres[0].querySelector('code')?.textContent).toBe('const a = [[1]] || b\n')
    expect(pres[0].querySelector('code')?.getAttribute('style')).toBeNull()
    expect(pres[1].textContent).toBe('plain\n')
    expect(pres[2].textContent).toBe('no language\n')
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('keeps inline code inline', () => {
    const { container } = renderMd({ body: 'Use `x` here.' })
    const code = screen.getByText('x')
    expect(code.tagName).toBe('CODE')
    expect(code.parentElement?.tagName).toBe('P')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('does not split a fence on a multi-line ||secret|| inside it', () => {
    const { container } = renderMd({ body: '```\nline ||one\ntwo|| end\n```\n\nAfter' })
    expect(container.querySelectorAll('pre')).toHaveLength(1)
    expect(container.querySelector('pre')?.textContent).toBe('line ||one\ntwo|| end\n')
    expect(container.querySelector('section')).toBeNull()
  })

  it('still tints a GM secret wrapped around a whole fence', () => {
    const { container } = renderMd({ body: '||\n```\nhidden code\n```\n||\n\nAfter' })
    const section = container.querySelector('section')
    expect(section?.querySelector('pre')?.textContent).toBe('hidden code\n')
    expect(screen.getByText('After').closest('section')).toBeNull()
  })

  it('still links and splits secrets around a fence in a list item', () => {
    renderMd({
      body: '- step\n  ```\n  [[Inside]]\n  ```\n\n[[Outside]] and ||gm note||',
      pages: [],
    })
    expect(screen.getByRole('button', { name: /^Outside/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inside/ })).toBeNull()
    expect(screen.getByText('gm note').tagName).toBe('SPAN')
  })

  it('hands Mermaid a GM secret as plain diagram text', async () => {
    renderMd({ body: '```mermaid\nflowchart LR\n  A --> B\n  ||B --> Traitor||\n```' })
    await screen.findByTestId('diagram')
    expect(mockRender).toHaveBeenCalledWith(
      expect.any(String),
      'flowchart LR\n  A --> B\n  B --> Traitor',
      'dark'
    )
  })

  it('does not prefetch a book embed written inside a fence', () => {
    const body = '```\n[[book:1:2]]\n```\n[[book:3:4]]'
    expect([...prefetchedBookEmbeds(body)]).toEqual(['book:3:4'])
  })
})

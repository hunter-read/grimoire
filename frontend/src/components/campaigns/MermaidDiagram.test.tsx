import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MermaidDiagram from './MermaidDiagram'
import { renderMermaid } from '../../lib/mermaid'

vi.mock('../../lib/mermaid', () => ({
  mermaidTheme: (mode: string | null) => (mode === 'light' ? 'default' : 'dark'),
  renderMermaid: vi.fn(),
}))
const mockRender = vi.mocked(renderMermaid)

const SOURCE = 'flowchart LR\n  A --> B'

beforeEach(() => {
  mockRender.mockReset()
  document.documentElement.setAttribute('data-theme', 'dark')
})
afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

describe('MermaidDiagram', () => {
  it('shows the source while rendering, then the SVG', async () => {
    let resolve: (svg: string) => void = () => {}
    mockRender.mockReturnValue(new Promise((r) => (resolve = r)))
    const { container } = render(<MermaidDiagram source={SOURCE} />)
    expect(container.querySelector('code')?.textContent).toBe(SOURCE)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    await act(async () => resolve('<svg data-testid="diagram"></svg>'))
    expect(await screen.findByTestId('diagram')).toBeInTheDocument()
    expect(container.querySelector('code')).toBeNull()
    expect(mockRender).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), SOURCE, 'dark')
  })

  it('falls back to the source with a note and the error behind a disclosure', async () => {
    mockRender.mockRejectedValue(new Error('Parse error on line 2'))
    const { container } = render(<MermaidDiagram source={'flowchart\n  A -->'} />)
    const note = await screen.findByText('This diagram could not be rendered.')
    expect(note).toHaveAttribute('title', 'Parse error on line 2')
    expect(container.querySelector('code')?.textContent).toBe('flowchart\n  A -->')
    expect(screen.getByText('Show error').tagName).toBe('SUMMARY')
    expect(screen.getByText('Parse error on line 2')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })

  it('reports a non-Error rejection too', async () => {
    mockRender.mockRejectedValue('bad diagram')
    render(<MermaidDiagram source="nonsense" />)
    expect(await screen.findByText('bad diagram')).toBeInTheDocument()
  })

  it('re-renders in the light theme when the colour mode changes', async () => {
    mockRender.mockResolvedValue('<svg data-testid="diagram"></svg>')
    render(<MermaidDiagram source={SOURCE} />)
    await screen.findByTestId('diagram')

    act(() => document.documentElement.setAttribute('data-theme', 'light'))
    await waitFor(() =>
      expect(mockRender).toHaveBeenLastCalledWith(expect.any(String), SOURCE, 'default')
    )
    // A fresh id per render, so the old SVG's id is never reused.
    const [first, second] = mockRender.mock.calls.map((c) => c[0])
    expect(first).not.toBe(second)
  })

  it('does not re-render for the same source', async () => {
    mockRender.mockResolvedValue('<svg data-testid="diagram"></svg>')
    const { rerender } = render(<MermaidDiagram source={SOURCE} />)
    await screen.findByTestId('diagram')
    rerender(<MermaidDiagram source={SOURCE} />)
    expect(mockRender).toHaveBeenCalledTimes(1)
  })

  it('ignores a render that finishes after unmount', async () => {
    let reject: (e: Error) => void = () => {}
    mockRender.mockReturnValue(new Promise((_r, j) => (reject = j)))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<MermaidDiagram source={SOURCE} />)
    await waitFor(() => expect(mockRender).toHaveBeenCalled())
    unmount()
    await act(async () => reject(new Error('late')))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

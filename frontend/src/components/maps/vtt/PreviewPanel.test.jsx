import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewPanel from './PreviewPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const state = (over = {}) => ({ enabled: false, sightRange: 0, lightRange: 4, ...over })

beforeEach(() => vi.clearAllMocks())

describe('PreviewPanel', () => {
  it('turns the preview on', async () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state()} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('turns it off again', async () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state({ enabled: true })} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /preview.hide/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('hides the ranges until the preview is on', () => {
    render(<PreviewPanel preview={state()} onChange={vi.fn()} />)
    // Off by default because the darkened view is in the way while drawing.
    expect(screen.queryByLabelText('maps.vtt.preview.sight')).toBeNull()
  })

  it('shows the ranges and how to move once on', () => {
    render(<PreviewPanel preview={state({ enabled: true })} onChange={vi.fn()} />)
    expect(screen.getByLabelText('maps.vtt.preview.sight')).toBeInTheDocument()
    expect(screen.getByLabelText('maps.vtt.preview.light')).toBeInTheDocument()
    expect(screen.getByText('maps.vtt.preview.moveHint')).toBeInTheDocument()
  })

  it('says the preview never reaches the file', () => {
    // The natural assumption is the opposite, and a GM tuning a torch radius
    // here would otherwise expect it in Foundry.
    render(<PreviewPanel preview={state({ enabled: true })} onChange={vi.fn()} />)
    expect(screen.getByText('maps.vtt.preview.notExported')).toBeInTheDocument()
  })

  it('edits the sight range', async () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state({ enabled: true })} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('maps.vtt.preview.sight'), '6')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sightRange: 6 }))
  })

  it('refuses a negative range', async () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state({ enabled: true, lightRange: 0 })} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('maps.vtt.preview.light'), '-3')
    for (const call of onChange.mock.calls) expect(call[0].lightRange).toBeGreaterThanOrEqual(0)
  })

  it('renders in its off state with no preview prop at all', () => {
    // It is one optional part of a large sidebar; a caller without the state
    // yet should get the control, not a crash.
    render(<PreviewPanel onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /preview.show/ })).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewPanel from './PreviewPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const state = (over = {}) => ({
  enabled: false,
  vision: true,
  nightVision: false,
  nightVisionRange: 12,
  lightRange: 4,
  ...over,
})

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

  it('hides the controls until the preview is on', () => {
    render(<PreviewPanel preview={state()} onChange={vi.fn()} />)
    // Off by default because the darkened view is in the way while drawing.
    expect(screen.queryByLabelText('maps.vtt.preview.vision')).toBeNull()
  })

  it('shows the vision controls and how to move once on', () => {
    render(<PreviewPanel preview={state({ enabled: true })} onChange={vi.fn()} />)
    expect(screen.getByLabelText('maps.vtt.preview.vision')).toBeInTheDocument()
    expect(screen.getByLabelText('maps.vtt.preview.nightVision')).toBeInTheDocument()
    expect(screen.getByLabelText('maps.vtt.preview.light')).toBeInTheDocument()
    expect(screen.getByText('maps.vtt.preview.moveHint')).toBeInTheDocument()
  })

  it('turns vision off, which is what an object token is set to', () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state({ enabled: true })} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('maps.vtt.preview.vision'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ vision: false }))
  })

  it('hides the sight controls when vision is off, since none of them apply', () => {
    render(<PreviewPanel preview={state({ enabled: true, vision: false })} onChange={vi.fn()} />)
    expect(screen.getByLabelText('maps.vtt.preview.vision')).toBeInTheDocument()
    expect(screen.queryByLabelText('maps.vtt.preview.nightVision')).toBeNull()
    expect(screen.queryByLabelText('maps.vtt.preview.light')).toBeNull()
  })

  it('reveals the night vision distance only once night vision is on', () => {
    const { rerender } = render(
      <PreviewPanel preview={state({ enabled: true })} onChange={vi.fn()} />
    )
    expect(screen.queryByLabelText('maps.vtt.preview.nightVisionRange')).toBeNull()
    rerender(
      <PreviewPanel preview={state({ enabled: true, nightVision: true })} onChange={vi.fn()} />
    )
    expect(screen.getByLabelText('maps.vtt.preview.nightVisionRange')).toBeInTheDocument()
  })

  it('edits the night vision distance', async () => {
    const onChange = vi.fn()
    render(
      <PreviewPanel
        preview={state({ enabled: true, nightVision: true, nightVisionRange: 0 })}
        onChange={onChange}
      />
    )
    await userEvent.type(screen.getByLabelText('maps.vtt.preview.nightVisionRange'), '6')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ nightVisionRange: 6 }))
  })

  it('warns when the token can see nothing on its own', () => {
    // No darkvision and no torch is a legitimate setup that looks like a bug,
    // so it is called out rather than left as a black screen.
    render(
      <PreviewPanel
        preview={state({ enabled: true, nightVision: false, lightRange: 0 })}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('maps.vtt.preview.darkHint')).toBeInTheDocument()
  })

  it('drops the warning once the token carries a light', () => {
    render(<PreviewPanel preview={state({ enabled: true, lightRange: 4 })} onChange={vi.fn()} />)
    expect(screen.queryByText('maps.vtt.preview.darkHint')).toBeNull()
  })

  it('says the preview never reaches the file', () => {
    // The natural assumption is the opposite, and a GM tuning a torch radius
    // here would otherwise expect it in Foundry.
    render(<PreviewPanel preview={state({ enabled: true })} onChange={vi.fn()} />)
    expect(screen.getByText('maps.vtt.preview.notExported')).toBeInTheDocument()
  })

  it('edits the carried light range', async () => {
    const onChange = vi.fn()
    render(<PreviewPanel preview={state({ enabled: true, lightRange: 0 })} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('maps.vtt.preview.light'), '6')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lightRange: 6 }))
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

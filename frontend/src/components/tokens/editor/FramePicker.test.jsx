import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import FramePicker from './FramePicker'
import { BUILTIN_FRAMES } from './frames'

const builtins = BUILTIN_FRAMES.map((f) => ({ ...f, group: '' }))
const userFrame = { id: 'abc', name: 'orc ring', group: 'Fantasy', builtin: false }

describe('FramePicker', () => {
  it('offers a "no frame" tile that leads the list', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    const none = screen.getByRole('button', { name: 'No frame' })
    expect(none).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders every built-in frame', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Player character' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Non-player character' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opponent' })).toBeInTheDocument()
  })

  it('marks the selected frame and reports changes', async () => {
    const onChange = vi.fn()
    render(<FramePicker frames={builtins} value="builtin:npc" onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Non-player character' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await userEvent.click(screen.getByRole('button', { name: 'Player character' }))
    expect(onChange).toHaveBeenCalledWith('builtin:pc')
  })

  it('clears the selection through the "no frame" tile', async () => {
    const onChange = vi.fn()
    render(<FramePicker frames={builtins} value="builtin:pc" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'No frame' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('groups user frames under the folder that holds them', () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(screen.getByText('Fantasy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
  })

  it('labels ungrouped user frames with a fallback heading', () => {
    render(
      <FramePicker
        frames={[...builtins, { id: 'x', name: 'plain', group: '', builtin: false }]}
        value={null}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('Library frames')).toBeInTheDocument()
  })

  it('explains how to add custom frames when the library has none', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    expect(
      screen.getByText(
        'Add your own frames by putting PNG, WebP, or SVG images in a folder named .frames inside your tokens library.'
      )
    ).toBeInTheDocument()
  })

  it('hides that hint once the library supplies frames', () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(
      screen.queryByText(
        'Add your own frames by putting PNG, WebP, or SVG images in a folder named .frames inside your tokens library.'
      )
    ).not.toBeInTheDocument()
  })

  it('withholds the hint while frames are still loading', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} loading />)
    expect(
      screen.queryByText(
        'Add your own frames by putting PNG, WebP, or SVG images in a folder named .frames inside your tokens library.'
      )
    ).not.toBeInTheDocument()
  })

  it('survives a missing catalogue', () => {
    render(<FramePicker frames={null} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'No frame' })).toBeInTheDocument()
  })
})

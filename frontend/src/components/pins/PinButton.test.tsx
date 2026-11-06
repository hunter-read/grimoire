import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PinButton from './PinButton'

describe('PinButton', () => {
  it('is a toggle named for what it pins', () => {
    const onToggle = vi.fn()
    const parent = vi.fn()
    render(
      <div onClick={parent}>
        <PinButton name="Tom Cartos" pinned={false} onToggle={onToggle} />
      </div>
    )
    const button = screen.getByRole('button', { name: 'Pin Tom Cartos' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveTextContent('Pin')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    // The folder header behind it does not also toggle.
    expect(parent).not.toHaveBeenCalled()
  })

  it('shows the pinned state as pressed', () => {
    render(<PinButton name="Tom Cartos" pinned onToggle={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Pin Tom Cartos' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Unpin Tom Cartos')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ToolbarButton from './ToolbarButton'

describe('settings/ToolbarButton', () => {
  it('renders children with a title and fires onClick', () => {
    const onClick = vi.fn()
    render(
      <ToolbarButton onClick={onClick} title="Bold">
        <b>B</b>
      </ToolbarButton>
    )
    const btn = screen.getByTitle('Bold')
    expect(btn).toHaveTextContent('B')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it('prevents default on mousedown (keeps the editor selection)', () => {
    render(<ToolbarButton title="Italic">I</ToolbarButton>)
    const btn = screen.getByTitle('Italic')
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })
})

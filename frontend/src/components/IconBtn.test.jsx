import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IconBtn from './IconBtn'

describe('IconBtn', () => {
  it('renders its children and title and fires onClick', async () => {
    const onClick = vi.fn()
    render(
      <IconBtn onClick={onClick} title="Zoom in">
        <span>+</span>
      </IconBtn>
    )
    const btn = screen.getByTitle('Zoom in')
    expect(btn).toHaveTextContent('+')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it('applies the active styling and extra style overrides', () => {
    render(
      <IconBtn title="B" active style={{ width: 50 }}>
        b
      </IconBtn>
    )
    const btn = screen.getByTitle('B')
    expect(btn.style.color).toBe('var(--gold)')
    expect(btn.style.width).toBe('50px')
  })
})

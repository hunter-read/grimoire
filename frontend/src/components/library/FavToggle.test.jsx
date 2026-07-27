import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FavToggle from './FavToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Favorites only' }),
}))

describe('FavToggle', () => {
  it('reflects the active state and fires onClick', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<FavToggle active={false} onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Favorites only' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
    rerender(<FavToggle active onClick={onClick} />)
    expect(screen.getByRole('button', { name: 'Favorites only' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

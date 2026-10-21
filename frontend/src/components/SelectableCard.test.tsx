import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => `${k}:${o?.name}` }),
}))

import SelectableCard from './SelectableCard'

describe('SelectableCard', () => {
  it('leaves the card untouched outside select mode', () => {
    render(
      <SelectableCard active={false} selected={false} label="Tome" onToggle={vi.fn()}>
        <a href="/book">Tome</a>
      </SelectableCard>
    )
    expect(screen.getByRole('link', { name: 'Tome' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('takes the click in select mode, passing the modifier keys', async () => {
    const onToggle = vi.fn()
    render(
      <SelectableCard active selected={false} label="Tome" onToggle={onToggle}>
        <a href="/book">Tome</a>
      </SelectableCard>
    )
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'bulk.selectItem:Tome' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(onToggle).toHaveBeenLastCalledWith({ shift: false, meta: false })
    await user.keyboard('{Shift>}')
    await user.click(toggle)
    expect(onToggle).toHaveBeenLastCalledWith({ shift: true, meta: false })
  })

  it('shows the selected state', () => {
    render(
      <SelectableCard active selected label="Tome" onToggle={vi.fn()}>
        <span>Tome</span>
      </SelectableCard>
    )
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
})

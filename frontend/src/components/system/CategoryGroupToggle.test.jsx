import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryGroupToggle from './CategoryGroupToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => (k === 'systemDetail.groupByCategory' ? 'Group by category' : k),
  }),
}))

describe('CategoryGroupToggle', () => {
  it('renders a switch checked when grouping is on', () => {
    render(<CategoryGroupToggle grouped onToggle={() => {}} />)
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('Group by category')).toBeInTheDocument()
  })

  it('is unchecked when grouping is off', () => {
    render(<CategoryGroupToggle grouped={false} onToggle={() => {}} />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('fires onToggle with the new value when clicked', async () => {
    const onToggle = vi.fn()
    render(<CategoryGroupToggle grouped onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})

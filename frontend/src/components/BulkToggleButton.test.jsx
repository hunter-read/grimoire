import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkToggleButton from './BulkToggleButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => ({ 'common.select': 'Select', 'common.cancel': 'Cancel' })[k] || k,
  }),
}))

describe('BulkToggleButton', () => {
  it('shows "Select" when inactive and "Cancel" when active', () => {
    const { rerender } = render(<BulkToggleButton active={false} onToggle={() => {}} />)
    expect(screen.getByText('Select')).toBeInTheDocument()
    rerender(<BulkToggleButton active={true} onToggle={() => {}} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('keeps a stable width across states (minWidth set)', () => {
    render(<BulkToggleButton active={false} onToggle={() => {}} />)
    expect(screen.getByText('Select').closest('button').style.minWidth).toBe('96px')
  })

  it('fires onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<BulkToggleButton active={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByText('Select'))
    expect(onToggle).toHaveBeenCalled()
  })
})

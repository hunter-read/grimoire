import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LogRow from './LogRow'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const entry = (over = {}) => ({
  timestamp: '2026-07-25T09:15:42.123Z',
  level: 'INFO',
  message: 'Scan complete',
  ...over,
})

describe('LogRow', () => {
  it('renders the time, level badge, and message', () => {
    render(<LogRow entry={entry()} />)
    expect(screen.getByText('09:15:42.123')).toBeInTheDocument()
    expect(screen.getByText('INFO')).toBeInTheDocument()
    expect(screen.getByLabelText('Message: Scan complete')).toBeInTheDocument()
  })

  it('highlights the matched search query in the message', () => {
    render(<LogRow entry={entry({ message: 'error opening file' })} searchQuery="opening" />)
    const mark = screen.getByText('opening')
    expect(mark.tagName).toBe('MARK')
  })

  it('renders plain message when the search query does not match', () => {
    render(<LogRow entry={entry({ message: 'all good' })} searchQuery="zzz" />)
    expect(screen.queryByText('zzz')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message: all good')).toBeInTheDocument()
  })

  it("shows the line's user as a chip that narrows to them", () => {
    const onUserClick = vi.fn()
    render(<LogRow entry={entry({ user: 'alice' })} onUserClick={onUserClick} />)
    const chip = screen.getByRole('button', { name: 'alice' })
    fireEvent.mouseEnter(chip)
    expect(chip.style.color).toBe('var(--gold)')
    fireEvent.mouseLeave(chip)
    expect(chip.style.color).toBe('var(--text-dim)')
    fireEvent.click(chip)
    expect(onUserClick).toHaveBeenCalledWith('alice')
  })

  it('leaves the chip out when the log is already narrowed or the line has no user', () => {
    const { rerender } = render(<LogRow entry={entry({ user: 'alice' })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<LogRow entry={entry({ user: null })} onUserClick={() => {}} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

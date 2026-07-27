import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LogRow from './LogRow'

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
})

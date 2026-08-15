import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CalendarMenu from './CalendarMenu'

vi.mock('../../api', () => ({
  campaigns: {
    getCalendarSubscription: vi.fn(),
    generateCalendarToken: vi.fn(),
    revokeCalendarToken: vi.fn(),
    downloadCalendar: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1', name: 'Curse of Strahd' }

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.getCalendarSubscription.mockResolvedValue({
    has_token: false,
    base_url_configured: true,
    feed_url: null,
    webcal_url: null,
    campaign_feed_url: null,
  })
  campaigns.downloadCalendar.mockResolvedValue(undefined)
})

describe('CalendarMenu', () => {
  it('opens a menu with both actions for a campaign', async () => {
    render(<CalendarMenu campaign={campaign} />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Download .ics')).toBeInTheDocument()
    expect(screen.getByText('Subscription link')).toBeInTheDocument()
  })

  it('downloads the .ics and closes the menu', async () => {
    render(<CalendarMenu campaign={campaign} />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    fireEvent.click(await screen.findByText('Download .ics'))

    await waitFor(() =>
      expect(campaigns.downloadCalendar).toHaveBeenCalledWith('c1', 'Curse of Strahd')
    )
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('opens the subscription dialog from the menu', async () => {
    render(<CalendarMenu campaign={campaign} />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    fireEvent.click(await screen.findByText('Subscription link'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('omits the download action for the global (all campaigns) variant', async () => {
    render(<CalendarMenu />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByText('Download .ics')).not.toBeInTheDocument()
    expect(screen.getByText('Subscription link')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(<CalendarMenu campaign={campaign} />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('closes when clicking outside', async () => {
    render(<CalendarMenu campaign={campaign} />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

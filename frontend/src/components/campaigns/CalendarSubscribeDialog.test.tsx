import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CalendarSubscribeDialog from './CalendarSubscribeDialog'

vi.mock('../../api', () => ({
  campaigns: {
    getCalendarSubscription: vi.fn(),
    generateCalendarToken: vi.fn(),
    revokeCalendarToken: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1', name: 'Curse of Strahd' }

const subscribed = {
  has_token: true,
  base_url_configured: true,
  feed_url: 'https://grim.example/api/campaigns/calendar/tok123/all.ics',
  webcal_url: 'webcal://grim.example/api/campaigns/calendar/tok123/all.ics',
  campaign_feed_url: 'https://grim.example/api/campaigns/calendar/tok123/c1.ics',
}

const unsubscribed = {
  has_token: false,
  base_url_configured: true,
  feed_url: null,
  webcal_url: null,
  campaign_feed_url: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.getCalendarSubscription.mockResolvedValue(unsubscribed)
  campaigns.generateCalendarToken.mockResolvedValue(subscribed)
  campaigns.revokeCalendarToken.mockResolvedValue(unsubscribed)
})

describe('CalendarSubscribeDialog', () => {
  it('loads the subscription state scoped to the campaign', async () => {
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)
    await waitFor(() => expect(campaigns.getCalendarSubscription).toHaveBeenCalledWith('c1'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('mints a token and shows both feed URLs', async () => {
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Get link'))

    await waitFor(() => expect(campaigns.generateCalendarToken).toHaveBeenCalledWith('c1'))
    expect(await screen.findByDisplayValue(subscribed.campaign_feed_url)).toBeInTheDocument()
    expect(screen.getByDisplayValue(subscribed.feed_url)).toBeInTheDocument()
  })

  it('shows only the aggregate feed for the global variant', async () => {
    campaigns.getCalendarSubscription.mockResolvedValue({
      ...subscribed,
      campaign_feed_url: null,
    })
    render(<CalendarSubscribeDialog onClose={() => {}} />)
    expect(await screen.findByDisplayValue(subscribed.feed_url)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(subscribed.campaign_feed_url)).not.toBeInTheDocument()
    // No campaign id is sent for the global feed.
    expect(campaigns.getCalendarSubscription).toHaveBeenCalledWith(undefined)
  })

  it('warns the link is personal and that RSVP does not flow back', async () => {
    campaigns.getCalendarSubscription.mockResolvedValue(subscribed)
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)
    expect(await screen.findByText(/This link is personal/i)).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('revokes the token and hides the URLs', async () => {
    campaigns.getCalendarSubscription.mockResolvedValue(subscribed)
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Revoke link'))
    await waitFor(() => expect(campaigns.revokeCalendarToken).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByDisplayValue(subscribed.feed_url)).not.toBeInTheDocument()
    )
  })

  it('copies a feed URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    campaigns.getCalendarSubscription.mockResolvedValue(subscribed)
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)

    const buttons = await screen.findAllByTitle('Copy')
    fireEvent.click(buttons[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(subscribed.campaign_feed_url))
  })

  it('explains when BASE_URL is unset and offers no link controls', async () => {
    campaigns.getCalendarSubscription.mockResolvedValue({
      has_token: false,
      base_url_configured: false,
      feed_url: null,
      webcal_url: null,
      campaign_feed_url: null,
    })
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)
    expect(await screen.findByText(/BASE_URL/i)).toBeInTheDocument()
    expect(screen.queryByText('Get link')).not.toBeInTheDocument()
  })

  it('surfaces an error when minting fails', async () => {
    campaigns.generateCalendarToken.mockRejectedValue(new Error('BASE_URL must be set'))
    render(<CalendarSubscribeDialog campaign={campaign} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Get link'))
    expect(await screen.findByText(/BASE_URL must be set/i)).toBeInTheDocument()
  })

  it('closes on Escape, the close button, and a scrim click', async () => {
    const onClose = vi.fn()
    const { container } = render(<CalendarSubscribeDialog campaign={campaign} onClose={onClose} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Close'))
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GuestPanel from './GuestPanel'

vi.mock('../../api', () => ({
  campaigns: {
    listGuests: vi.fn(),
    createGuest: vi.fn(),
    regenerateGuestCode: vi.fn(),
    removeGuest: vi.fn(),
    guestShareTemplate: vi.fn(),
  },
}))

import { campaigns } from '../../api'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GuestPanel', () => {
  it('lists existing guests with their codes', async () => {
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    render(<GuestPanel campaignId="c1" onChanged={vi.fn()} />)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.getByText('ABC1234567')).toBeTruthy()
  })

  it('creates a guest and reloads', async () => {
    campaigns.listGuests.mockResolvedValue([])
    campaigns.createGuest.mockResolvedValue({
      id: 'm2',
      user_id: 'g2',
      nickname: 'Bob',
      guest_code: 'XYZ7654321',
    })
    const onChanged = vi.fn()
    render(<GuestPanel campaignId="c1" onChanged={onChanged} />)
    await screen.findByText(/no guests/i)

    const input = screen.getByPlaceholderText(/nickname/i)
    fireEvent.change(input, { target: { value: 'Bob' } })
    // After create, listGuests is called again — return the new guest.
    campaigns.listGuests.mockResolvedValue([
      { id: 'm2', user_id: 'g2', nickname: 'Bob', guest_code: 'XYZ7654321' },
    ])
    fireEvent.click(screen.getByText(/^Add$/))

    await waitFor(() => expect(campaigns.createGuest).toHaveBeenCalledWith('c1', 'Bob'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('opens the share modal with copy/email actions', async () => {
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    campaigns.guestShareTemplate.mockResolvedValue({
      message: 'join here',
      discord_message: 'discord join',
      mailto_url: 'mailto:test@example.com',
    })
    render(<GuestPanel campaignId="c1" onChanged={vi.fn()} />)
    await screen.findByText('Alice')

    fireEvent.click(screen.getByTitle(/share/i))

    // ShareBtn buttons + mailto span render inside the modal.
    expect(await screen.findByDisplayValue('join here')).toBeTruthy()
    expect(screen.getByText(/copy for discord/i)).toBeTruthy()
    expect(screen.getByText(/email/i)).toBeTruthy()
  })
})

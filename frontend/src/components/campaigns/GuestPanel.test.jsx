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

  it('copies the share message to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })
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
    await screen.findByDisplayValue('join here')

    fireEvent.click(screen.getByText(/copy for discord/i))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('discord join'))
  })

  it('regenerates a guest code', async () => {
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    campaigns.regenerateGuestCode.mockResolvedValue({})
    render(<GuestPanel campaignId="c1" onChanged={vi.fn()} />)
    await screen.findByText('Alice')

    fireEvent.click(screen.getByTitle(/regenerate/i))
    await waitFor(() => expect(campaigns.regenerateGuestCode).toHaveBeenCalledWith('c1', 'm1'))
  })

  it('removes a guest after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    campaigns.removeGuest.mockResolvedValue({})
    const onChanged = vi.fn()
    render(<GuestPanel campaignId="c1" onChanged={onChanged} />)
    await screen.findByText('Alice')

    fireEvent.click(screen.getByTitle(/remove/i))
    await waitFor(() => expect(campaigns.removeGuest).toHaveBeenCalledWith('c1', 'm1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not remove a guest when confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    render(<GuestPanel campaignId="c1" onChanged={vi.fn()} />)
    await screen.findByText('Alice')

    fireEvent.click(screen.getByTitle(/remove/i))
    expect(campaigns.removeGuest).not.toHaveBeenCalled()
  })

  it('surfaces an error when regenerate fails', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    campaigns.listGuests.mockResolvedValue([
      { id: 'm1', user_id: 'g1', nickname: 'Alice', guest_code: 'ABC1234567' },
    ])
    campaigns.regenerateGuestCode.mockRejectedValue(new Error('boom'))
    render(<GuestPanel campaignId="c1" onChanged={vi.fn()} />)
    await screen.findByText('Alice')

    fireEvent.click(screen.getByTitle(/regenerate/i))
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('boom'))
  })

  it('closes the share modal', async () => {
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
    await screen.findByDisplayValue('join here')

    fireEvent.click(screen.getByText(/close/i))
    await waitFor(() => expect(screen.queryByDisplayValue('join here')).toBeNull())
  })
})

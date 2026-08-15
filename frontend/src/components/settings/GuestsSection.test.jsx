import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GuestsSection from './GuestsSection'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import api from '../../api'

const guests = [
  {
    id: 'guest-1',
    display_name: 'Ivy',
    campaign_id: 'camp-1',
    campaign_name: 'Curse of Strahd',
    invited_by: 'DM Dave',
  },
]

// The same person invited to two campaigns: two separate guest accounts that an
// admin needs to be able to join up. The third is orphaned — no campaign, no
// inviter — which used to leave it undeletable.
const duplicateGuests = [
  ...guests,
  {
    id: 'guest-2',
    display_name: 'Ivy',
    campaign_id: 'camp-2',
    campaign_name: 'Dragon Heist',
    invited_by: 'DM Dave',
  },
  {
    id: 'guest-3',
    display_name: 'Orphan',
    campaign_id: null,
    campaign_name: null,
    invited_by: null,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue(guests)
})

const expand = async () => {
  render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /guests/i }))
  await screen.findByText('Ivy')
}

describe('GuestsSection', () => {
  it('lazy-loads guests only when expanded', async () => {
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    expect(api.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/guests'))
  })

  it('renders a row with name, campaign, and inviter', async () => {
    await expand()
    expect(screen.getByText('Ivy')).toBeInTheDocument()
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.getByText('DM Dave')).toBeInTheDocument()
  })

  it('shows the empty state when there are no guests', async () => {
    api.get.mockResolvedValue([])
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText(/no guests/i)
  })

  it('converts a guest and reports the new user upward', async () => {
    const converted = { id: 'guest-1', username: 'ivy_perm', role: 'player' }
    api.post.mockResolvedValue(converted)
    const onConverted = vi.fn()
    render(<GuestsSection passwordAuthEnabled onConverted={onConverted} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')

    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'ivy_perm' },
    })
    fireEvent.change(screen.getByPlaceholderText(/new password/i), {
      target: { value: 'supersecret1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/guest-1/convert', {
        username: 'ivy_perm',
        role: 'player',
        password: 'supersecret1',
      })
    )
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith(converted))
    // Row is removed once converted.
    expect(screen.queryByText('Ivy')).toBeNull()
  })

  it('omits the password field when password auth is disabled', async () => {
    render(<GuestsSection passwordAuthEnabled={false} onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')
    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    expect(screen.queryByPlaceholderText(/new password/i)).toBeNull()
  })

  it('shows an error when conversion fails', async () => {
    api.post.mockRejectedValue({ body: { detail: 'Username already exists' } })
    render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /guests/i }))
    await screen.findByText('Ivy')
    fireEvent.click(screen.getByRole('button', { name: /convert/i }))
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByPlaceholderText(/new password/i), {
      target: { value: 'supersecret1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))
    await screen.findByText('Username already exists')
  })

  describe('merging duplicate guest accounts', () => {
    const expandDuplicates = async () => {
      api.get.mockResolvedValue(duplicateGuests)
      render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /guests/i }))
      await screen.findByText('Curse of Strahd')
    }

    // Rows render in `duplicateGuests` order, and the two duplicates share a
    // display name, so select by row position rather than by label.
    const selectGuests = (...ids) => {
      const boxes = screen.getAllByRole('checkbox')
      for (const id of ids) {
        fireEvent.click(boxes[duplicateGuests.findIndex((g) => g.id === id)])
      }
    }

    it('offers a merge action once anything is selected', async () => {
      await expandDuplicates()
      expect(screen.queryByRole('button', { name: /^merge$/i })).toBeNull()

      // A single guest is mergeable on its own — into a permanent account.
      selectGuests('guest-1')
      expect(screen.getByRole('button', { name: /^merge$/i })).toBeInTheDocument()
    })

    // "Connect them" also means folding a guest into the real account the same
    // person already signs in with, not just guest-to-guest.
    it('offers permanent users as a merge target', async () => {
      api.get.mockResolvedValue(duplicateGuests)
      render(
        <GuestsSection
          passwordAuthEnabled
          users={[{ id: 'user-1', username: 'ivy', display_name: 'Ivy Real' }]}
          onConverted={vi.fn()}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: /guests/i }))
      await screen.findByText('Curse of Strahd')

      selectGuests('guest-1')
      expect(screen.getByRole('option', { name: 'Ivy Real' })).toBeInTheDocument()
    })

    it('merges a lone guest into a permanent account', async () => {
      api.get.mockResolvedValue(duplicateGuests)
      api.post.mockResolvedValue({ id: 'user-1', merged_ids: ['guest-1'], memberships_moved: 1 })
      render(
        <GuestsSection
          passwordAuthEnabled
          users={[{ id: 'user-1', username: 'ivy', display_name: 'Ivy Real' }]}
          onConverted={vi.fn()}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: /guests/i }))
      await screen.findByText('Curse of Strahd')

      selectGuests('guest-1')
      fireEvent.change(screen.getByLabelText(/account to keep/i), {
        target: { value: 'user-1' },
      })
      fireEvent.click(screen.getByRole('button', { name: /^merge$/i }))

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/users/user-1/merge', {
          source_ids: ['guest-1'],
        })
      )
      await waitFor(() => expect(screen.queryByText('Curse of Strahd')).toBeNull())
    })

    it('merges the selected accounts into the chosen target', async () => {
      api.post.mockResolvedValue({ id: 'guest-1', merged_ids: ['guest-2'], memberships_moved: 1 })
      await expandDuplicates()

      selectGuests('guest-1', 'guest-2')
      fireEvent.change(screen.getByLabelText(/account to keep/i), {
        target: { value: 'guest-1' },
      })
      fireEvent.click(screen.getByRole('button', { name: /^merge$/i }))

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/users/guest-1/merge', {
          source_ids: ['guest-2'],
        })
      )
      // The merged-away row disappears; the surviving account stays.
      await waitFor(() => expect(screen.queryByText('Dragon Heist')).toBeNull())
      expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    })

    it('surfaces a merge failure', async () => {
      api.post.mockRejectedValue({ body: { detail: 'Cannot merge an account into itself' } })
      await expandDuplicates()

      selectGuests('guest-1', 'guest-2')
      fireEvent.change(screen.getByLabelText(/account to keep/i), {
        target: { value: 'guest-1' },
      })
      fireEvent.click(screen.getByRole('button', { name: /^merge$/i }))

      await screen.findByText('Cannot merge an account into itself')
    })
  })

  describe('deleting a guest', () => {
    beforeEach(() => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
    })

    // A guest whose campaign was deleted has no campaign and no inviter, and
    // previously had no action that could remove it.
    it('deletes a guest that has no campaign or inviter', async () => {
      api.get.mockResolvedValue(duplicateGuests)
      api.delete.mockResolvedValue(undefined)
      render(<GuestsSection passwordAuthEnabled onConverted={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /guests/i }))
      await screen.findByText('Orphan')

      const deleteButtons = screen.getAllByRole('button', { name: /delete guest/i })
      fireEvent.click(deleteButtons[2])

      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/guest-3'))
      await waitFor(() => expect(screen.queryByText('Orphan')).toBeNull())
    })

    it('does not delete when the confirmation is dismissed', async () => {
      window.confirm.mockReturnValue(false)
      await expand()

      fireEvent.click(screen.getByRole('button', { name: /delete guest/i }))
      expect(api.delete).not.toHaveBeenCalled()
      expect(screen.getByText('Ivy')).toBeInTheDocument()
    })

    it('shows an error when deletion fails', async () => {
      api.delete.mockRejectedValue({ body: { detail: 'Failed to delete guest.' } })
      await expand()

      fireEvent.click(screen.getByRole('button', { name: /delete guest/i }))
      await screen.findByText('Failed to delete guest.')
      expect(screen.getByText('Ivy')).toBeInTheDocument()
    })
  })
})

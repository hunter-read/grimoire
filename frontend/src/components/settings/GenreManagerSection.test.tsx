import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenreManagerSection from './GenreManagerSection'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <div>spinner</div> }))
vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const genres = [
  { id: 'g1', name: 'Fantasy', parent_id: null, is_default: true, sort_order: 1 },
  { id: 'g2', name: 'Grimdark', parent_id: 'g1', is_default: true, sort_order: 1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ genres })
  api.post.mockResolvedValue({ id: 'g3', name: 'New' })
  api.delete.mockResolvedValue({ status: 'ok' })
})

describe('GenreManagerSection', () => {
  it('lists genres after load', async () => {
    render(<GenreManagerSection />)
    // "Fantasy" appears in both the parent dropdown and the list, so assert
    // via the unique remove button label instead.
    expect(await screen.findByLabelText('common.remove Fantasy')).toBeInTheDocument()
    expect(screen.getByLabelText('common.remove Grimdark')).toBeInTheDocument()
  })

  it('creates a genre', async () => {
    render(<GenreManagerSection />)
    await screen.findByLabelText('common.remove Fantasy')
    await userEvent.type(screen.getByLabelText('lookupSettings.namePlaceholder'), 'Western')
    await userEvent.click(screen.getByText('lookupSettings.add'))
    expect(api.post).toHaveBeenCalledWith('/genres', { name: 'Western', parent_id: null })
  })

  it('deletes an unused genre directly', async () => {
    render(<GenreManagerSection />)
    await screen.findByLabelText('common.remove Fantasy')
    await userEvent.click(screen.getByLabelText('common.remove Fantasy'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/genres/g1'))
  })

  it('shows a confirm modal when a genre is in use, then force-deletes', async () => {
    api.delete.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        status: 409,
        body: { detail: { name: 'Fantasy', usage_count: 3 } },
      })
    )
    render(<GenreManagerSection />)
    await screen.findByLabelText('common.remove Fantasy')
    await userEvent.click(screen.getByLabelText('common.remove Fantasy'))
    // Confirm modal appears with usage count.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    api.delete.mockResolvedValueOnce({ status: 'ok', removed_usage: 3 })
    await userEvent.click(screen.getByText('lookupSettings.confirmRemove'))
    await waitFor(() => expect(api.delete).toHaveBeenLastCalledWith('/genres/g1?force=true'))
  })
})

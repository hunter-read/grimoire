import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DatabaseCleanupSection from './DatabaseCleanupSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({ default: { post: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
})

const cleanupButton = () => screen.getByRole('button')

describe('DatabaseCleanupSection', () => {
  it('renders its heading and description', () => {
    render(<DatabaseCleanupSection />)

    expect(screen.getByText('maintenance.cleanup.title')).toBeInTheDocument()
    expect(screen.getByText('maintenance.cleanup.description')).toBeInTheDocument()
  })

  it('posts the cleanup request and reports the outcome', async () => {
    api.post.mockResolvedValue({ removed: { books: 2, maps: 1, tokens: 0 } })
    render(<DatabaseCleanupSection />)

    await userEvent.click(cleanupButton())

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/maintenance/cleanup-missing'))
    expect(await screen.findByText('maintenance.cleanup.removed')).toBeInTheDocument()
    expect(screen.getByText('maintenance.cleanup.books')).toBeInTheDocument()
    expect(screen.getByText('maintenance.cleanup.maps')).toBeInTheDocument()
  })

  it('reports when there was nothing to remove', async () => {
    api.post.mockResolvedValue({ removed: { books: 0, maps: 0, tokens: 0 } })
    render(<DatabaseCleanupSection />)

    await userEvent.click(cleanupButton())

    expect(await screen.findByText('maintenance.cleanup.nothingToRemove')).toBeInTheDocument()
  })

  it('surfaces a failure message', async () => {
    api.post.mockRejectedValue(new Error('nope'))
    render(<DatabaseCleanupSection />)

    await userEvent.click(cleanupButton())

    expect(await screen.findByText('maintenance.cleanup.failed')).toBeInTheDocument()
  })

  // The error text and the destructive button both used a hardcoded red that
  // ignored the theme.
  it('renders the error in the themed danger colour', async () => {
    api.post.mockRejectedValue(new Error('nope'))
    render(<DatabaseCleanupSection />)

    await userEvent.click(cleanupButton())

    const error = await screen.findByText('maintenance.cleanup.failed')
    expect(error).toHaveStyle({ color: 'var(--danger)' })
  })

  it('disables the button while the cleanup is running', async () => {
    let resolve
    api.post.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    render(<DatabaseCleanupSection />)

    await userEvent.click(cleanupButton())
    expect(cleanupButton()).toBeDisabled()

    resolve({ removed: { books: 0, maps: 0, tokens: 0 } })
    await waitFor(() => expect(cleanupButton()).not.toBeDisabled())
  })
})

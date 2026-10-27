import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RescanButton from './RescanButton'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../api'

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue({ running: false, phase: null })
  api.post.mockResolvedValue({})
})

describe('RescanButton', () => {
  it('opens the modal and posts the scoped rescan on confirm', async () => {
    render(<RescanButton scope="books/D&D 5e/adventure" />)
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }))

    const confirm = await screen.findByText('Start rescan')
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rescan', {
        scope: 'books/D&D 5e/adventure',
        metadata_mode: 'new',
      })
    })
  })

  it('posts the selected metadata mode', async () => {
    render(<RescanButton scope="maps/Forests" />)
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }))

    fireEvent.click(await screen.findByText('Update missing metadata'))
    fireEvent.click(screen.getByText('Start rescan'))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rescan', {
        scope: 'maps/Forests',
        metadata_mode: 'missing',
      })
    })
  })
})

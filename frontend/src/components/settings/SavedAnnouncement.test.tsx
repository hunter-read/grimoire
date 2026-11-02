import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SavedAnnouncement from './SavedAnnouncement'

describe('SavedAnnouncement', () => {
  it('is an empty live region until the change has saved', () => {
    const { rerender } = render(<SavedAnnouncement saved={false} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('')
    rerender(<SavedAnnouncement saved />)
    expect(status).toHaveTextContent('Saved')
  })
})

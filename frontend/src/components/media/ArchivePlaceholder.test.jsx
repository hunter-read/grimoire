import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ArchivePlaceholder from './ArchivePlaceholder'

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))

describe('ArchivePlaceholder', () => {
  it('renders a download link pointing at the media file endpoint', () => {
    render(<ArchivePlaceholder fileUrl="/maps/m1/file" filename="pack.zip" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('http://localhost/maps/m1/file')
    expect(link.getAttribute('download')).toBe('pack.zip')
  })

  it('explains that the archive cannot be previewed', () => {
    render(<ArchivePlaceholder fileUrl="/tokens/t1/file" filename="tokens.zip" />)
    expect(screen.getByText(/cannot be previewed/i)).toBeInTheDocument()
  })

  it('falls back to an empty download name when filename is missing', () => {
    render(<ArchivePlaceholder fileUrl="/audio/a1/file" />)
    expect(screen.getByRole('link').getAttribute('download')).toBe('')
  })
})

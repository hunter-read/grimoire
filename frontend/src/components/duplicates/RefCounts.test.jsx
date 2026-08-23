import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RefCounts from './RefCounts'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k.split('.').pop() }) }))

describe('RefCounts', () => {
  it('lists only the counts that are non-zero', () => {
    render(<RefCounts counts={{ bookmarks: 3, favorites: 0, tags: 2 }} />)
    expect(screen.getByText('3 bookmarks, 2 tags')).toBeInTheDocument()
  })

  it('renders nothing when every count is zero', () => {
    // "0 bookmarks, 0 favorites" is noise on a row whose job is to show which
    // copy carries real user work.
    const { container } = render(<RefCounts counts={{ bookmarks: 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no counts at all', () => {
    const { container } = render(<RefCounts counts={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

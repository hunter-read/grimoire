import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddonsTab from './AddonsTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('./AddonsSection', () => ({ default: () => <div>addons-section</div> }))

describe('AddonsTab', () => {
  it('renders the add-ons manager', () => {
    render(<AddonsTab />)
    expect(screen.getByText('addons-section')).toBeInTheDocument()
  })

  // Add-ons are filed by what they do, so the heading names the category
  // ("Metadata scrapers") rather than repeating "Community add-ons" under the
  // Add-ons tab. Future categories sit alongside this one.
  it('groups add-ons under their category heading', () => {
    render(<AddonsTab />)
    expect(screen.getByText('addons.categories.metadata')).toBeInTheDocument()
    expect(screen.getByText('addons.categories.metadataDesc')).toBeInTheDocument()
    expect(screen.queryByText('addons.title')).not.toBeInTheDocument()
  })
})

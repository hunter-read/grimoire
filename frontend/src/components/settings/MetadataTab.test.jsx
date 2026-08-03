import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MetadataTab from './MetadataTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('./GenreManagerSection', () => ({ default: () => <div>genre-manager</div> }))
vi.mock('./SystemFamilyManagerSection', () => ({ default: () => <div>family-manager</div> }))
vi.mock('./ParentSystemManagerSection', () => ({ default: () => <div>parent-manager</div> }))
vi.mock('./LicenseManagerSection', () => ({ default: () => <div>license-manager</div> }))
vi.mock('./DiceMaterialManagerSection', () => ({ default: () => <div>dice-manager</div> }))

describe('MetadataTab', () => {
  it('renders every metadata manager (all sections open by default)', () => {
    render(<MetadataTab />)
    expect(screen.getByText('genre-manager')).toBeInTheDocument()
    expect(screen.getByText('family-manager')).toBeInTheDocument()
    expect(screen.getByText('parent-manager')).toBeInTheDocument()
    expect(screen.getByText('license-manager')).toBeInTheDocument()
    expect(screen.getByText('dice-manager')).toBeInTheDocument()
  })

  it('does not host the add-ons manager (it has its own tab)', () => {
    render(<MetadataTab />)
    expect(screen.queryByRole('button', { name: /addons.title/i })).toBeNull()
  })

  it('collapses a section when its header is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<MetadataTab />)
    // The genres header toggles its manager body.
    await userEvent.click(screen.getByRole('button', { name: /lookupSettings.genresTitle/i }))
    expect(screen.queryByText('genre-manager')).not.toBeInTheDocument()
  })
})

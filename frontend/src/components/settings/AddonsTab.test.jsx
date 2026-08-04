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

  it('explains what add-ons are', () => {
    render(<AddonsTab />)
    expect(screen.getByText('addons.title')).toBeInTheDocument()
    expect(screen.getByText('addons.description')).toBeInTheDocument()
  })
})

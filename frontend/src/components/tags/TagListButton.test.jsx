import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TagListButton from './TagListButton'

const tag = { internal: 'city watch', display: 'City Watch', count: 4 }

const renderButton = (props) =>
  render(
    <MemoryRouter>
      <TagListButton {...props} />
    </MemoryRouter>
  )

describe('TagListButton', () => {
  it('renders the tag label and its count', () => {
    renderButton({ tag, active: false })

    expect(screen.getByText('City Watch')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  // TagListButton is now a real <Link> — plain click is handled natively by
  // the router; assert the href rather than an onSelect spy.
  it('renders a link to the tag filtered URL', () => {
    renderButton({ tag, active: false })

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/tags?tag=city%20watch')
  })

  // Middle-click opens a new tab natively because the component is a real anchor.
  // No JS to test — just verify the anchor has the right href.
  it('is a real anchor so middle click opens a new tab natively', () => {
    renderButton({ tag, active: false })

    const link = screen.getByRole('link')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/tags?tag=city%20watch')
  })

  it('marks the active tag as current', () => {
    renderButton({ tag, active: true })

    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'true')
  })
})

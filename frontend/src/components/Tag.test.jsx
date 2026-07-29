import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Tag from './Tag'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const renderTag = (props) =>
  render(
    <MemoryRouter>
      <Tag {...props} />
    </MemoryRouter>
  )

describe('Tag', () => {
  it('renders the label text', () => {
    renderTag({ label: 'fantasy' })
    expect(screen.getByText('Fantasy')).toBeInTheDocument()
  })

  it('capitalizes the first letter', () => {
    renderTag({ label: 'dungeon-crawl' })
    expect(screen.getByText('Dungeon-crawl')).toBeInTheDocument()
  })

  it('handles single-character labels', () => {
    renderTag({ label: 'a' })
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('renders without throwing when label is undefined', () => {
    renderTag({})
  })

  it('renders without throwing when label is an empty string', () => {
    renderTag({ label: '' })
  })

  it('applies a custom background color when provided', () => {
    renderTag({ label: 'test', color: '#ff0000' })
    const el = screen.getByText('Test')
    expect(el.style.background).toBe('rgb(255, 0, 0)')
  })

  it('navigates to the tags page (by internal key) when a linkable tag is clicked', async () => {
    renderTag({ label: 'Draw Steel' })
    await userEvent.click(screen.getByText('Draw Steel'))
    expect(mockNavigate).toHaveBeenCalledWith('/tags?tag=draw%20steel')
  })

  it('renders a non-interactive span when linkable is false', () => {
    renderTag({ label: 'fantasy', linkable: false })
    const el = screen.getByText('Fantasy')
    expect(el.tagName).toBe('SPAN')
  })
})

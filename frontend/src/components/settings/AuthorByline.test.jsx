import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthorByline from './AuthorByline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.author ? `${k}:${opts.author}` : k),
  }),
}))

describe('AuthorByline', () => {
  it('credits the author', () => {
    render(<AuthorByline author="hunter-read" />)
    expect(screen.getByText('addons.byAuthor:hunter-read')).toBeInTheDocument()
  })

  it('renders nothing without an author', () => {
    const { container } = render(<AuthorByline />)
    expect(container).toBeEmptyDOMElement()
  })

  it('treats a blank author as absent', () => {
    // Manifests are hand-written, so a whitespace-only value is realistic and
    // must not render an empty "by " credit.
    const { container } = render(<AuthorByline author="   " />)
    expect(container).toBeEmptyDOMElement()
  })

  it('links to the GitHub profile when the server resolved one', () => {
    render(<AuthorByline author="hunter-read" authorUrl="https://github.com/hunter-read" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/hunter-read')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('never makes the name itself the link', () => {
    // The name is self-declared manifest text: only the icon is clickable, so
    // the credit cannot be dressed up as a link to somewhere else.
    render(<AuthorByline author="hunter-read" authorUrl="https://github.com/hunter-read" />)
    expect(screen.getByText('addons.byAuthor:hunter-read').closest('a')).toBeNull()
  })

  it('renders a plain name with no link when there is no profile URL', () => {
    const { container } = render(<AuthorByline author="Jane Doe" />)
    expect(screen.getByText('addons.byAuthor:Jane Doe')).toBeInTheDocument()
    expect(container.querySelector('a')).toBeNull()
  })
})

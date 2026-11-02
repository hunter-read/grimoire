import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PageTextForScreenReaders, { paragraphs } from './PageTextForScreenReaders'

describe('paragraphs', () => {
  it('splits on blank lines and joins the wrapped lines inside one', () => {
    expect(paragraphs('One\nline\n\n  Two  \n\n\n')).toEqual(['One line', 'Two'])
  })
})

describe('PageTextForScreenReaders', () => {
  it('gives each page a heading and its text', () => {
    render(
      <PageTextForScreenReaders
        pages={[
          { page: 4, text: 'Left page.' },
          { page: 5, text: 'Right page.' },
        ]}
        totalPages={10}
      />
    )
    expect(screen.getByRole('heading', { name: 'Page 4 of 10' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Page 5 of 10' })).toBeInTheDocument()
    expect(screen.getByText('Right page.')).toBeInTheDocument()
  })

  it('shows nothing under the heading while the text is still loading', () => {
    render(<PageTextForScreenReaders pages={[{ page: 1, text: undefined }]} totalPages={2} />)
    const section = screen.getByRole('region', { name: 'Page 1 of 2' })
    expect(section.querySelectorAll('p')).toHaveLength(0)
  })

  it('says a page without a text layer has nothing to read', () => {
    render(<PageTextForScreenReaders pages={[{ page: 1, text: '  ' }]} totalPages={2} />)
    expect(screen.getByText('This page has no text layer to read.')).toBeInTheDocument()
  })
})

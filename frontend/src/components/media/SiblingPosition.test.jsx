import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SiblingPosition from './SiblingPosition'

describe('SiblingPosition', () => {
  it('shows a one-based position in the folder', () => {
    render(<SiblingPosition index={2} total={12} label="3 of 12" />)
    expect(screen.getByText('3 / 12')).toBeInTheDocument()
  })

  it('exposes a spoken label for screen readers', () => {
    render(<SiblingPosition index={0} total={4} label="1 of 4" />)
    expect(screen.getByLabelText('1 of 4')).toBeInTheDocument()
  })

  // A count of one is noise: there is nowhere to navigate.
  it('renders nothing for a folder of one', () => {
    const { container } = render(<SiblingPosition index={0} total={1} label="1 of 1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the item has not been located yet', () => {
    const { container } = render(<SiblingPosition index={-1} total={5} label="" />)
    expect(container).toBeEmptyDOMElement()
  })
})

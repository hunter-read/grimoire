import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SiblingNavButtons from './SiblingNavButtons'

const props = {
  hasPrev: true,
  hasNext: true,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  prevLabel: 'Previous map',
  nextLabel: 'Next map',
}

describe('SiblingNavButtons', () => {
  it('renders both arrows when there is somewhere to go either way', () => {
    render(<SiblingNavButtons {...props} />)
    expect(screen.getByRole('button', { name: 'Previous map' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next map' })).toBeInTheDocument()
  })

  it('hides the previous arrow at the start of the folder', () => {
    render(<SiblingNavButtons {...props} hasPrev={false} />)
    expect(screen.queryByRole('button', { name: 'Previous map' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next map' })).toBeInTheDocument()
  })

  it('hides the next arrow at the end of the folder', () => {
    render(<SiblingNavButtons {...props} hasNext={false} />)
    expect(screen.queryByRole('button', { name: 'Next map' })).not.toBeInTheDocument()
  })

  it('renders nothing for a folder of one', () => {
    const { container } = render(<SiblingNavButtons {...props} hasPrev={false} hasNext={false} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('calls the handlers when clicked', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<SiblingNavButtons {...props} onPrev={onPrev} onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next map' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  // Each collection names its own item, so the labels are passed in rather than
  // hardcoded — a screen reader should say "Previous token" on a token.
  it('uses the labels it is given', () => {
    render(<SiblingNavButtons {...props} prevLabel="Previous track" nextLabel="Next track" />)
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeInTheDocument()
    expect(screen.getByTitle('Next track')).toBeInTheDocument()
  })
})

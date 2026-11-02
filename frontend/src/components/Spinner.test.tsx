import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Spinner from './Spinner'

describe('Spinner', () => {
  it('is a loading status on its own', () => {
    render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
  })

  it('stays out of the name of a button it sits in', () => {
    render(
      <button>
        <Spinner size={12} /> Save
      </button>
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAccessibleName('Save')
  })

  it('can be marked decorative by hand', () => {
    const { container } = render(<Spinner decorative />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

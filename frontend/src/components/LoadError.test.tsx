import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoadError from './LoadError'

describe('LoadError', () => {
  it('says the page could not be loaded, and offers to try again', async () => {
    const onRetry = vi.fn()
    render(<LoadError onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This could not be loaded.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('says a missing item is gone, with nothing to retry', () => {
    render(<LoadError notFound onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be found/)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the caller’s message in place of the generic one', () => {
    render(<LoadError message="The campaign list is unavailable." />)
    expect(screen.getByRole('alert')).toHaveTextContent('The campaign list is unavailable.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

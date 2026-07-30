import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchInput from './SearchInput'

describe('SearchInput', () => {
  it('renders with a placeholder and forwards typed input', async () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} placeholder="Filter maps…" />)
    const input = screen.getByPlaceholderText('Filter maps…')
    await userEvent.type(input, 'd')
    expect(onChange).toHaveBeenCalledWith('d')
  })

  it('uses the placeholder as the aria-label by default', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Filter tokens…" />)
    expect(screen.getByLabelText('Filter tokens…')).toBeInTheDocument()
  })

  it('prefers an explicit ariaLabel over the placeholder', () => {
    render(
      <SearchInput value="" onChange={vi.fn()} placeholder="Search" ariaLabel="Search audio" />
    )
    expect(screen.getByLabelText('Search audio')).toBeInTheDocument()
  })

  it('hides the clear button when empty', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Search" />)
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
  })

  it('shows a clear button when there is a value and clears on click', async () => {
    const onChange = vi.fn()
    render(<SearchInput value="dragon" onChange={onChange} placeholder="Search" />)
    await userEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(onChange).toHaveBeenCalledWith('')
  })
})

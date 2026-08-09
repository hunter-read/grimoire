import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagListButton from './TagListButton'

const tag = { internal: 'city watch', display: 'City Watch', count: 4 }

describe('TagListButton', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('renders the tag label and its count', () => {
    render(<TagListButton tag={tag} active={false} onSelect={vi.fn()} />)

    expect(screen.getByText('City Watch')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('selects the tag by its internal key on a plain click', async () => {
    const onSelect = vi.fn()
    render(<TagListButton tag={tag} active={false} onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith('city watch')
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the tag in a new tab on middle click, with the key URL-encoded', async () => {
    const onSelect = vi.fn()
    render(<TagListButton tag={tag} active={false} onSelect={onSelect} />)

    await userEvent.pointer({ target: screen.getByRole('button'), keys: '[MouseMiddle]' })

    expect(open).toHaveBeenCalledWith('/tags?tag=city%20watch', '_blank', 'noopener,noreferrer')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks the active tag as current', () => {
    render(<TagListButton tag={tag} active onSelect={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import FrameGroup from './FrameGroup'

describe('FrameGroup', () => {
  it('shows its children while open', () => {
    render(
      <FrameGroup label="Fantasy" open onToggle={vi.fn()}>
        <button type="button">orc ring</button>
      </FrameGroup>
    )
    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fantasy/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides its children while closed, keeping the heading reachable', () => {
    render(
      <FrameGroup label="Fantasy" open={false} onToggle={vi.fn()}>
        <button type="button">orc ring</button>
      </FrameGroup>
    )
    expect(screen.queryByRole('button', { name: 'orc ring' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fantasy/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('reports a heading click', async () => {
    const onToggle = vi.fn()
    render(
      <FrameGroup label="Fantasy" open onToggle={onToggle}>
        <span />
      </FrameGroup>
    )
    await userEvent.click(screen.getByRole('button', { name: /Fantasy/ }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('renders an optional leading icon beside the label', () => {
    render(
      <FrameGroup label="Favourites" icon={<span data-testid="icon" />} open onToggle={vi.fn()}>
        <span />
      </FrameGroup>
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidebarSection from './SidebarSection'

describe('SidebarSection', () => {
  it('shows its body when open', () => {
    render(
      <SidebarSection title="Selection" open onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('unmounts the body when closed, keeping its inputs out of the tab order', () => {
    // Hiding with CSS would leave a focusable field in a collapsed section —
    // a keyboard trap with no visible focus.
    render(
      <SidebarSection title="Selection" open={false} onToggle={vi.fn()}>
        <input aria-label="range" />
      </SidebarSection>
    )
    expect(screen.queryByLabelText('range')).toBeNull()
  })

  it('reports its state to assistive tech', () => {
    const { rerender } = render(
      <SidebarSection title="Selection" open onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByRole('button', { name: /Selection/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    rerender(
      <SidebarSection title="Selection" open={false} onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByRole('button', { name: /Selection/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('asks to be toggled when the header is clicked', async () => {
    const onToggle = vi.fn()
    render(
      <SidebarSection title="Selection" open onToggle={onToggle}>
        <p>body</p>
      </SidebarSection>
    )
    await userEvent.click(screen.getByRole('button', { name: /Selection/ }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('shows a count so a collapsed section still says how much it hides', () => {
    render(
      <SidebarSection title="Layers" count={7} open={false} onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByRole('button', { name: /Layers/ })).toHaveTextContent('7')
  })

  it('omits the count when there is none, including zero-less sections', () => {
    render(
      <SidebarSection title="Grid" open={false} onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByRole('button', { name: /Grid/ })).toHaveTextContent('Grid')
  })

  it('still shows a count of zero, which is a real answer', () => {
    render(
      <SidebarSection title="Layers" count={0} open={false} onToggle={vi.fn()}>
        <p>body</p>
      </SidebarSection>
    )
    expect(screen.getByRole('button', { name: /Layers/ })).toHaveTextContent('0')
  })
})

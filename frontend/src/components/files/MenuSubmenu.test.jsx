import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MenuSubmenu from './MenuSubmenu'

const renderSub = (props = {}) =>
  render(
    <MenuSubmenu label="Pin folder" itemStyle={{}} hoverProps={{}} testId="sub" {...props}>
      <button data-testid="leaf">Pin right</button>
    </MenuSubmenu>
  )

describe('MenuSubmenu', () => {
  it('keeps its panel closed until asked', () => {
    renderSub()
    expect(screen.queryByTestId('sub-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('sub')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on hover', () => {
    renderSub()
    fireEvent.mouseEnter(screen.getByTestId('sub').parentElement)
    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()
  })

  it('opens on click without a preceding hover', async () => {
    renderSub()
    // Keyboard and touch never fire mouseEnter, so click alone must open it.
    fireEvent.click(screen.getByTestId('sub'))
    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()
  })

  it('stays open when clicked after hovering', async () => {
    renderSub()
    // A pointer user hovers (opening it) and then clicks to commit; a toggle
    // here would close the panel on the very click meant to open it.
    await userEvent.click(screen.getByTestId('sub'))
    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()
    expect(screen.getByTestId('leaf')).toBeInTheDocument()
  })

  it('closes shortly after the pointer leaves', () => {
    vi.useFakeTimers()
    renderSub()
    const row = screen.getByTestId('sub').parentElement

    fireEvent.mouseEnter(row)
    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()

    fireEvent.mouseLeave(row)
    // Not immediately: the diagonal path to the panel crosses dead space, and
    // closing at once would make the submenu unreachable by mouse.
    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(250))
    expect(screen.queryByTestId('sub-panel')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('stays open while the pointer is inside the panel', () => {
    vi.useFakeTimers()
    renderSub()
    const row = screen.getByTestId('sub').parentElement

    fireEvent.mouseEnter(row)
    fireEvent.mouseLeave(row)
    fireEvent.mouseEnter(screen.getByTestId('sub-panel'))
    act(() => vi.advanceTimersByTime(400))

    expect(screen.getByTestId('sub-panel')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('does not let its click reach the menu behind it', async () => {
    const onOuterClick = vi.fn()
    render(
      <div onClick={onOuterClick}>
        <MenuSubmenu label="Pin" itemStyle={{}} hoverProps={{}} testId="sub">
          <button data-testid="leaf">Pin right</button>
        </MenuSubmenu>
      </div>
    )
    // The context menu closes on any outside click; opening a submenu must not
    // count as one.
    await userEvent.click(screen.getByTestId('sub'))
    expect(onOuterClick).not.toHaveBeenCalled()
  })
})

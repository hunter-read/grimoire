import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useLinkProps, { useNewTabHandler, isNewTabClick } from './useLinkProps'

function Card({ to, onActivate }) {
  const linkProps = useLinkProps(to, onActivate)
  return (
    <div {...linkProps} role="button" tabIndex={0}>
      card
    </div>
  )
}

function NewTabButton({ to }) {
  const onNewTab = useNewTabHandler(to)
  return (
    <button type="button" onAuxClick={onNewTab} onClick={onNewTab}>
      go
    </button>
  )
}

describe('isNewTabClick', () => {
  it('is true for a middle-button auxclick', () => {
    expect(isNewTabClick({ type: 'auxclick', button: 1 })).toBe(true)
  })

  it('is false for a right-button auxclick', () => {
    expect(isNewTabClick({ type: 'auxclick', button: 2 })).toBe(false)
  })

  it('is true for a modified left click', () => {
    expect(isNewTabClick({ type: 'click', button: 0, metaKey: true })).toBe(true)
    expect(isNewTabClick({ type: 'click', button: 0, ctrlKey: true })).toBe(true)
    expect(isNewTabClick({ type: 'click', button: 0, shiftKey: true })).toBe(true)
  })

  it('is false for a plain left click', () => {
    expect(isNewTabClick({ type: 'click', button: 0 })).toBe(false)
  })

  it('is false for a missing event', () => {
    expect(isNewTabClick(null)).toBe(false)
  })
})

describe('useLinkProps', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('runs the normal handler on a plain click', async () => {
    const onActivate = vi.fn()
    render(<Card to="/library/system/7" onActivate={onActivate} />)

    await userEvent.click(screen.getByRole('button'))

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the target in a new tab on middle click', async () => {
    const onActivate = vi.fn()
    render(<Card to="/library/system/7" onActivate={onActivate} />)

    await userEvent.pointer({
      target: screen.getByRole('button'),
      keys: '[MouseMiddle]',
    })

    expect(open).toHaveBeenCalledWith('/library/system/7', '_blank', 'noopener,noreferrer')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('opens the target in a new tab on ctrl-click instead of navigating', async () => {
    const onActivate = vi.fn()
    render(<Card to="/maps/3" onActivate={onActivate} />)

    // A single setup() session keeps the modifier held across the click; the
    // default export resets keyboard state between calls.
    const user = userEvent.setup()
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button'))
    await user.keyboard('{/Control}')

    expect(open).toHaveBeenCalledWith('/maps/3', '_blank', 'noopener,noreferrer')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('ignores a right-button aux click', async () => {
    render(<Card to="/maps/3" onActivate={vi.fn()} />)

    await userEvent.pointer({
      target: screen.getByRole('button'),
      keys: '[MouseRight]',
    })

    expect(open).not.toHaveBeenCalled()
  })

  it('falls back to the normal handler when there is no target', async () => {
    const onActivate = vi.fn()
    render(<Card to={null} onActivate={onActivate} />)

    await userEvent.click(screen.getByRole('button'))
    await userEvent.pointer({ target: screen.getByRole('button'), keys: '[MouseMiddle]' })

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('exposes the target as data-href, and omits it without one', () => {
    const { rerender } = render(<Card to="/tokens/9" onActivate={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('data-href', '/tokens/9')

    rerender(<Card to={null} onActivate={vi.fn()} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('data-href')
  })
})

describe('useNewTabHandler', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('opens the target on middle click', async () => {
    render(<NewTabButton to="/audio/2" />)

    await userEvent.pointer({ target: screen.getByRole('button'), keys: '[MouseMiddle]' })

    expect(open).toHaveBeenCalledWith('/audio/2', '_blank', 'noopener,noreferrer')
  })

  it('does nothing on a plain click', async () => {
    render(<NewTabButton to="/audio/2" />)

    await userEvent.click(screen.getByRole('button'))

    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing without a target', async () => {
    render(<NewTabButton to={null} />)

    await userEvent.pointer({ target: screen.getByRole('button'), keys: '[MouseMiddle]' })

    expect(open).not.toHaveBeenCalled()
  })
})

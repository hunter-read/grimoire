import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PortalProperties from './PortalProperties'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const portal = {
  bounds: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  closed: true,
  freestanding: false,
}

describe('PortalProperties', () => {
  it('shows a closed portal as a door', () => {
    render(<PortalProperties portal={portal} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'maps.vtt.portal.door' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('shows an open portal as a window', () => {
    // closed: false is exactly how importers read a window.
    render(
      <PortalProperties
        portal={{ ...portal, closed: false }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'maps.vtt.portal.window' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('switches a door to a window', async () => {
    const onChange = vi.fn()
    render(<PortalProperties portal={portal} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.portal.window' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ closed: false }))
  })

  it('switches a window back to a door', async () => {
    const onChange = vi.fn()
    render(
      <PortalProperties
        portal={{ ...portal, closed: false }}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.portal.door' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ closed: true }))
  })

  it('toggles freestanding', async () => {
    const onChange = vi.fn()
    render(<PortalProperties portal={portal} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ freestanding: true }))
  })

  it('keeps the bounds untouched when editing properties', async () => {
    // bounds is the load-bearing field — position and rotation are derived from
    // it on export, so a property edit must never disturb it.
    const onChange = vi.fn()
    render(<PortalProperties portal={portal} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.portal.window' }))
    expect(onChange.mock.calls[0][0].bounds).toEqual(portal.bounds)
  })

  it('offers no control the format cannot carry', () => {
    // Secret and locked are set after import in Roll20; the file cannot hold
    // them, so offering the toggle would silently lose the setting.
    const { container } = render(
      <PortalProperties portal={portal} onChange={vi.fn()} onDelete={vi.fn()} />
    )
    expect(container.textContent).not.toMatch(/secret|locked|one-way/i)
  })

  it('deletes on request', async () => {
    const onDelete = vi.fn()
    render(<PortalProperties portal={portal} onChange={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /deleteSelected/ }))
    expect(onDelete).toHaveBeenCalled()
  })
})

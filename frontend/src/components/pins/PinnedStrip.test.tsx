import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PinnedStrip from './PinnedStrip'

const pin = (id: string, target: string) => ({ id, collection: 'maps', target })

describe('PinnedStrip', () => {
  it('renders nothing with no pins', () => {
    const { container } = render(<PinnedStrip links={[]} onUnpin={vi.fn()} label="Pinned" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('links each pin and unpins from its ×', () => {
    const onUnpin = vi.fn()
    const night = pin('p1', 'Czepeku/Night')
    render(
      <MemoryRouter>
        <PinnedStrip
          label="Pinned folders in Maps"
          links={[
            { pin: night, label: 'Night', detail: 'Czepeku', to: '/maps?folder=Czepeku%2FNight' },
            { pin: pin('p2', 'Tom Cartos'), label: 'Tom Cartos', to: '/maps?folder=Tom+Cartos' },
          ]}
          onUnpin={onUnpin}
        />
      </MemoryRouter>
    )
    expect(screen.getByRole('navigation', { name: 'Pinned folders in Maps' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Night/ })
    expect(link).toHaveAttribute('href', '/maps?folder=Czepeku%2FNight')
    expect(link).toHaveTextContent('Czepeku › Night')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Night' }))
    expect(onUnpin).toHaveBeenCalledWith(night)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../images/ImageSourceBrowser', () => ({
  TOKEN_SOURCE_TYPES: ['token'],
  default: ({ onChange, types }) => (
    <button
      type="button"
      data-types={(types || []).join(',')}
      onClick={() => onChange({ source_type: 'token', source_id: 't1' })}
    >
      pick-library-image
    </button>
  ),
}))

import TokenSourcePicker from './TokenSourcePicker'

const png = () => new File(['x'], 'art.png', { type: 'image/png' })

describe('TokenSourcePicker', () => {
  it('takes a file from the device', async () => {
    const onFile = vi.fn()
    render(<TokenSourcePicker onFile={onFile} onPickSource={vi.fn()} />)
    await userEvent.upload(screen.getByTestId('token-source-input'), png())
    expect(onFile).toHaveBeenCalledWith(expect.any(File))
  })

  it('opens the file dialog from the button', async () => {
    render(<TokenSourcePicker onFile={vi.fn()} onPickSource={vi.fn()} />)
    const input = screen.getByTestId('token-source-input')
    const click = vi.spyOn(input, 'click')
    await userEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
    expect(click).toHaveBeenCalled()
  })

  it('accepts a dropped image', () => {
    const onFile = vi.fn()
    render(<TokenSourcePicker onFile={onFile} onPickSource={vi.fn()} />)
    fireEvent.drop(screen.getByTestId('token-source-dropzone'), {
      dataTransfer: { files: [png()] },
    })
    expect(onFile).toHaveBeenCalled()
  })

  it('ignores a dropped non-image', () => {
    const onFile = vi.fn()
    render(<TokenSourcePicker onFile={onFile} onPickSource={vi.fn()} />)
    fireEvent.drop(screen.getByTestId('token-source-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('takes an image pasted from the clipboard', () => {
    const onFile = vi.fn()
    render(<TokenSourcePicker onFile={onFile} onPickSource={vi.fn()} active />)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { items: [], files: [png()] }
    document.dispatchEvent(event)
    expect(onFile).toHaveBeenCalled()
  })

  it('switches to the library browser and reports a pick', async () => {
    const onPickSource = vi.fn()
    render(<TokenSourcePicker onFile={vi.fn()} onPickSource={onPickSource} />)

    await userEvent.click(screen.getByRole('button', { name: /Library/ }))
    await userEvent.click(screen.getByRole('button', { name: 'pick-library-image' }))

    expect(onPickSource).toHaveBeenCalledWith({ source_type: 'token', source_id: 't1' })
  })

  it('highlights the dropzone while a drag is over it', () => {
    render(<TokenSourcePicker onFile={vi.fn()} onPickSource={vi.fn()} />)
    const zone = screen.getByTestId('token-source-dropzone')
    const idle = zone.getAttribute('style')

    fireEvent.dragOver(zone)
    expect(zone.getAttribute('style')).not.toBe(idle)

    fireEvent.dragLeave(zone)
    expect(zone.getAttribute('style')).toBe(idle)
  })

  it('browses only the token library', async () => {
    // The token editor browses the token library and nothing else: book covers,
    // album art, and battlemaps are none of them a character portrait.
    render(<TokenSourcePicker onFile={vi.fn()} onPickSource={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))

    expect(screen.getByRole('button', { name: 'pick-library-image' })).toHaveAttribute(
      'data-types',
      'token'
    )
  })
})

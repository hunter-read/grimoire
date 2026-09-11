import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VttSourcePicker, { isAcceptedSource } from './VttSourcePicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const file = (name, type = '') => new File(['x'], name, { type })

beforeEach(() => vi.clearAllMocks())

describe('isAcceptedSource', () => {
  it.each([
    ['a PNG', file('m.png', 'image/png')],
    ['a JPEG', file('m.jpg', 'image/jpeg')],
    ['a WebP', file('m.webp', 'image/webp')],
  ])('accepts %s', (_label, f) => expect(isAcceptedSource(f)).toBe(true))

  it('accepts a .uvtt by name whatever type the browser reports', () => {
    // Browsers report JSON inconsistently and often give an unknown extension
    // an empty type, so the name is the only reliable signal for this format.
    expect(isAcceptedSource(file('m.uvtt', ''))).toBe(true)
    expect(isAcceptedSource(file('m.dd2vtt', 'application/json'))).toBe(true)
  })

  it.each([
    ['a PDF', file('m.pdf', 'application/pdf')],
    ['a video', file('m.webm', 'video/webm')],
    ['nothing', null],
  ])('rejects %s', (_label, f) => expect(isAcceptedSource(f)).toBe(false))
})

describe('VttSourcePicker', () => {
  it('hands over a chosen file', async () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    await userEvent.upload(screen.getByTestId('vtt-source-input'), file('m.png', 'image/png'))
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'm.png' }))
  })

  it('accepts a dropped file', () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    const dropped = file('tavern.uvtt')
    fireEvent.drop(screen.getByTestId('vtt-source-dropzone'), {
      dataTransfer: { files: [dropped] },
    })
    expect(onFile).toHaveBeenCalledWith(dropped)
  })

  it('ignores a dropped file it cannot open', () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    fireEvent.drop(screen.getByTestId('vtt-source-dropzone'), {
      dataTransfer: { files: [file('notes.pdf', 'application/pdf')] },
    })
    // A PDF has pages rather than a single raster to calibrate a grid against.
    expect(onFile).not.toHaveBeenCalled()
  })

  it('picks the first usable file out of a mixed drop', () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    const good = file('m.png', 'image/png')
    fireEvent.drop(screen.getByTestId('vtt-source-dropzone'), {
      dataTransfer: { files: [file('notes.pdf', 'application/pdf'), good] },
    })
    expect(onFile).toHaveBeenCalledWith(good)
  })

  it('highlights the dropzone while a file is over it', () => {
    render(<VttSourcePicker onFile={vi.fn()} />)
    const zone = screen.getByTestId('vtt-source-dropzone')
    const plain = zone.getAttribute('style')

    fireEvent.dragOver(zone)
    // The border and fill change so it is obvious the drop will land here.
    expect(zone.getAttribute('style')).not.toBe(plain)
    expect(zone.getAttribute('style')).toContain('--gold')

    fireEvent.dragLeave(zone)
    expect(zone.getAttribute('style')).toBe(plain)
  })

  it('stops highlighting once the file is dropped', () => {
    render(<VttSourcePicker onFile={vi.fn()} />)
    const zone = screen.getByTestId('vtt-source-dropzone')
    fireEvent.dragOver(zone)
    const active = zone.getAttribute('style')
    fireEvent.drop(zone, { dataTransfer: { files: [file('m.png', 'image/png')] } })
    expect(zone.getAttribute('style')).not.toBe(active)
  })

  it('survives a drop carrying no files', () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    fireEvent.drop(screen.getByTestId('vtt-source-dropzone'), { dataTransfer: {} })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('ignores an empty file selection', async () => {
    const onFile = vi.fn()
    render(<VttSourcePicker onFile={onFile} />)
    fireEvent.change(screen.getByTestId('vtt-source-input'), { target: { files: [] } })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows an error when given one', () => {
    render(<VttSourcePicker onFile={vi.fn()} error="that failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('that failed')
  })

  it('offers both image and Universal VTT extensions to the file dialog', () => {
    render(<VttSourcePicker onFile={vi.fn()} />)
    const accept = screen.getByTestId('vtt-source-input').getAttribute('accept')
    expect(accept).toContain('image/png')
    expect(accept).toContain('.uvtt')
    expect(accept).toContain('.dd2vtt')
  })
})

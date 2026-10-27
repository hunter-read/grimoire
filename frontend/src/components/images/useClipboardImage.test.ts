import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useClipboardImage, { imageFromDataTransfer } from './useClipboardImage'

const pngFile = (name = 'shot.png') => new File(['x'], name, { type: 'image/png' })

// Minimal DataTransfer stand-in: jsdom does not implement the clipboard item
// API, and only `items`/`files` are ever read.
const transfer = ({ items = [], files = [] } = {}) => ({
  items: items.map((f) => ({ kind: 'file', getAsFile: () => f })),
  files,
})

describe('imageFromDataTransfer', () => {
  it('returns the first acceptable image from items', () => {
    const file = pngFile()
    expect(imageFromDataTransfer(transfer({ items: [file] }))).toBe(file)
  })

  it('falls back to files when items is empty', () => {
    const file = pngFile()
    expect(imageFromDataTransfer(transfer({ files: [file] }))).toBe(file)
  })

  it('ignores payloads that are not accepted image types', () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    expect(imageFromDataTransfer(transfer({ items: [pdf], files: [pdf] }))).toBeNull()
  })

  it('names an unnamed clipboard image after its type', () => {
    const unnamed = new File(['x'], '', { type: 'image/webp' })
    const out = imageFromDataTransfer(transfer({ items: [unnamed] }))
    expect(out.name).toBe('pasted.webp')
    expect(out.type).toBe('image/webp')
  })

  it('tolerates a missing DataTransfer', () => {
    expect(imageFromDataTransfer(null)).toBeNull()
    expect(imageFromDataTransfer(undefined)).toBeNull()
  })
})

describe('useClipboardImage', () => {
  const paste = (dataTransfer) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = dataTransfer
    document.dispatchEvent(event)
    return event
  }

  it('calls back with a pasted image', () => {
    const onImage = vi.fn()
    renderHook(() => useClipboardImage(onImage, true))
    const file = pngFile()

    const event = paste(transfer({ items: [file] }))

    expect(onImage).toHaveBeenCalledWith(file)
    // The event is claimed only when an image was actually handled.
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores a paste holding no image, leaving the event for others', () => {
    const onImage = vi.fn()
    renderHook(() => useClipboardImage(onImage, true))

    const event = paste(transfer({ items: [] }))

    expect(onImage).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not listen while inactive', () => {
    const onImage = vi.fn()
    renderHook(() => useClipboardImage(onImage, false))

    paste(transfer({ items: [pngFile()] }))

    expect(onImage).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const onImage = vi.fn()
    const { unmount } = renderHook(() => useClipboardImage(onImage, true))
    unmount()

    paste(transfer({ items: [pngFile()] }))

    expect(onImage).not.toHaveBeenCalled()
  })
})

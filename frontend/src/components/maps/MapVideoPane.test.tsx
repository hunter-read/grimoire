import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MapVideoPane from './MapVideoPane'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const video = () => document.querySelector('video')

describe('MapVideoPane', () => {
  it('streams the original file and loops muted for a battlemap', () => {
    render(<MapVideoPane mapId="m1" filename="storm.webm" />)
    const el = video()
    expect(el.getAttribute('src')).toContain('/maps/m1/file')
    expect(el.loop).toBe(true)
    expect(el.muted).toBe(true)
    expect(el.hasAttribute('controls')).toBe(true)
  })

  it('spins until the video has data, then reveals it', () => {
    render(<MapVideoPane mapId="m1" filename="storm.webm" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(video().style.opacity).toBe('0')

    fireEvent.loadedData(video())

    expect(screen.queryByRole('status')).toBeNull()
    expect(video().style.opacity).toBe('1')
  })

  it('reports an unplayable video', () => {
    render(<MapVideoPane mapId="m1" filename="storm.webm" />)
    fireEvent.error(video())
    expect(screen.getByText('maps.detail.videoFailed')).toBeTruthy()
  })

  it('resets to loading when switching maps', () => {
    const { rerender } = render(<MapVideoPane mapId="m1" filename="a.webm" />)
    fireEvent.loadedData(video())
    rerender(<MapVideoPane mapId="m2" filename="b.mp4" />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

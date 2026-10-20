import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetPortrait from './SheetPortrait'
import { CharacterMediaContext } from './characterMedia'
import type { CharacterMedia } from './characterMedia'

const mockUpload = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    portraitUrl: (id: string, v?: number) => `/api/characters/${id}/portrait${v ? `?v=${v}` : ''}`,
    uploadPortrait: (...a: unknown[]) => mockUpload(...a),
    deletePortrait: vi.fn(),
  },
}))

const media = (overrides: Partial<CharacterMedia> = {}): CharacterMedia => ({
  character: { id: 'c1', name: 'Vex', portrait_path: null },
  readOnly: false,
  onPortraitChanged: vi.fn(),
  onImageChanged: vi.fn(),
  onError: vi.fn(),
  openPortrait: vi.fn(),
  ...overrides,
})

const renderWith = (value: CharacterMedia | null, className?: string) =>
  render(
    <CharacterMediaContext.Provider value={value}>
      <SheetPortrait className={className} />
    </CharacterMediaContext.Provider>
  )

beforeEach(() => vi.clearAllMocks())

describe('SheetPortrait', () => {
  it('draws nothing outside a character', () => {
    const { container } = renderWith(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the art framed as chosen, and opens it large', async () => {
    const value = media({
      character: {
        id: 'c1',
        name: 'Vex',
        portrait_path: 'c1.png',
        portrait_version: 3,
        portrait_crop: { x: 50, y: 5, zoom: 1.5 },
      },
    })
    const { container } = renderWith(value, 'tall')
    const image = screen.getByAltText('Portrait of Vex') as HTMLImageElement
    expect(image).toHaveAttribute('src', '/api/characters/c1/portrait?v=3')
    expect(image.style.objectPosition).toBe('50% 5%')
    expect(container.querySelector('figure')).toHaveClass('gc-portrait', 'tall')
    await userEvent.click(screen.getByRole('button', { name: 'View art' }))
    expect(value.openPortrait).toHaveBeenCalled()
  })

  it('offers the owner a place to add art', async () => {
    mockUpload.mockResolvedValue({ portrait_path: 'c1.png', portrait_version: 7 })
    const value = media()
    renderWith(value)
    expect(screen.getByRole('button', { name: 'Add art' })).toBeInTheDocument()
    await userEvent.upload(
      screen.getByLabelText('Add art', { selector: 'input' }),
      new File(['x'], 'p.png', { type: 'image/png' })
    )
    await waitFor(() =>
      expect(value.onPortraitChanged).toHaveBeenCalledWith({
        portrait_path: 'c1.png',
        portrait_version: 7,
        portrait_crop: null,
      })
    )
  })

  it('reports a failed upload', async () => {
    mockUpload.mockRejectedValue(new Error('too big'))
    const value = media()
    renderWith(value)
    await userEvent.upload(
      screen.getByLabelText('Add art', { selector: 'input' }),
      new File(['x'], 'p.png', { type: 'image/png' })
    )
    await waitFor(() => expect(value.onError).toHaveBeenCalledWith('too big'))
  })

  it('shows a party member no empty frame', () => {
    const { container } = renderWith(media({ readOnly: true }))
    expect(container).toBeEmptyDOMElement()
  })
})

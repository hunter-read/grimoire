import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterPortrait from './CharacterPortrait'

const mockUpload = vi.fn()
const mockDelete = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    portraitUrl: (id, v) => `/api/characters/${id}/portrait${v ? `?v=${v}` : ''}`,
    uploadPortrait: (...a) => mockUpload(...a),
    deletePortrait: (...a) => mockDelete(...a),
  },
}))

const WITH_ART = { id: 'c1', name: 'Vex', portrait_path: 'c1.png', portrait_version: 5 }
const WITHOUT_ART = { id: 'c1', name: 'Vex', portrait_path: null, portrait_version: null }
const png = () => new File(['x'], 'p.png', { type: 'image/png' })

const renderPortrait = (props = {}) => {
  const onChanged = vi.fn()
  const onError = vi.fn()
  render(
    <CharacterPortrait character={WITHOUT_ART} onChanged={onChanged} onError={onError} {...props} />
  )
  return { onChanged, onError }
}

beforeEach(() => vi.clearAllMocks())

describe('CharacterPortrait', () => {
  it('invites adding art when there is none', () => {
    renderPortrait()
    expect(screen.getByRole('button', { name: 'Add art' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove art' })).not.toBeInTheDocument()
  })

  it('opens the file picker from the thumbnail', async () => {
    renderPortrait()
    const input = screen.getByLabelText('Add art', { selector: 'input' })
    const click = vi.spyOn(input, 'click')
    await userEvent.click(screen.getByRole('button', { name: 'Add art' }))
    expect(click).toHaveBeenCalled()
  })

  it('uploads art and reports the new version', async () => {
    mockUpload.mockResolvedValue({ portrait_path: 'c1.png', portrait_version: 9 })
    const { onChanged } = renderPortrait()
    const file = png()
    await userEvent.upload(screen.getByLabelText('Add art', { selector: 'input' }), file)
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ portrait_path: 'c1.png', portrait_version: 9 })
    )
    expect(mockUpload).toHaveBeenCalledWith('c1', file)
  })

  it('still busts the cache when the server sends no version', async () => {
    mockUpload.mockResolvedValue({ portrait_path: 'c1.png' })
    const { onChanged } = renderPortrait()
    await userEvent.upload(screen.getByLabelText('Add art', { selector: 'input' }), png())
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(onChanged.mock.calls[0][0].portrait_version).toBeGreaterThan(0)
  })

  it('lets the same file be picked again after an upload', async () => {
    mockUpload.mockResolvedValue({ portrait_path: 'c1.png', portrait_version: 1 })
    renderPortrait()
    const input = screen.getByLabelText('Add art', { selector: 'input' })
    await userEvent.upload(input, png())
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('shows the art under its versioned URL and offers to change it', () => {
    renderPortrait({ character: WITH_ART })
    expect(screen.getByAltText('Portrait of Vex')).toHaveAttribute(
      'src',
      '/api/characters/c1/portrait?v=5'
    )
    expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument()
  })

  it('removes art after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDelete.mockResolvedValue({})
    const { onChanged } = renderPortrait({ character: WITH_ART })
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    expect(mockDelete).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ portrait_path: null, portrait_version: null })
    )
  })

  it('keeps the art when removal is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPortrait({ character: WITH_ART })
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('reports a failed upload or removal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUpload.mockRejectedValue(new Error('too big'))
    mockDelete.mockRejectedValue(new Error('gone'))
    const { onError } = renderPortrait({ character: WITH_ART })
    await userEvent.upload(screen.getByLabelText('Change art', { selector: 'input' }), png())
    await waitFor(() => expect(onError).toHaveBeenCalledWith('too big'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('gone'))
  })

  it('shows a party member’s art without any controls', () => {
    renderPortrait({ character: WITH_ART, readOnly: true })
    expect(screen.getByAltText('Portrait of Vex')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows nothing read-only when there is no art', () => {
    const { container } = render(
      <CharacterPortrait character={WITHOUT_ART} readOnly onChanged={vi.fn()} onError={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})

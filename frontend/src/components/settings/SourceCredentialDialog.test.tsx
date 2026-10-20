import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SourceCredentialDialog from './SourceCredentialDialog'
import { addons } from '../../api'

vi.mock('../../api', () => ({
  addons: { setSourceCredential: vi.fn(), clearSourceCredential: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : k),
  }),
}))

const url = 'https://raw.githubusercontent.com/our-table/private-packs/main/index.json'
const setCredential = vi.mocked(addons.setSourceCredential)
const clearCredential = vi.mocked(addons.clearSourceCredential)

type Info = Parameters<typeof SourceCredentialDialog>[0]['info']

function renderDialog(info?: Info) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <SourceCredentialDialog
      url={url}
      name="our-table/private-packs"
      info={info}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
  return { onClose, onSaved }
}

const saved = { header: 'Authorization', env_locked: false, unreadable: false }

describe('SourceCredentialDialog', () => {
  beforeEach(() => {
    setCredential.mockReset()
    clearCredential.mockReset()
  })

  it('saves a token with the default Authorization header', async () => {
    setCredential.mockResolvedValue({ source_credentials: { [url]: saved } } as never)
    const { onSaved } = renderDialog()

    const save = screen.getByRole('button', { name: 'addons.tokenSave' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('addons.tokenLabel'), {
      target: { value: '  github_pat_x  ' },
    })
    fireEvent.click(save)

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ [url]: saved }))
    expect(setCredential).toHaveBeenCalledWith({
      url,
      token: 'github_pat_x',
      header: 'Authorization',
    })
  })

  it('sends a custom header', async () => {
    setCredential.mockResolvedValue({ source_credentials: {} } as never)
    renderDialog()
    fireEvent.change(screen.getByLabelText('addons.tokenLabel'), { target: { value: 'tok' } })
    fireEvent.change(screen.getByLabelText('addons.tokenHeaderLabel'), {
      target: { value: 'PRIVATE-TOKEN' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenSave' }))
    await waitFor(() =>
      expect(setCredential).toHaveBeenCalledWith({ url, token: 'tok', header: 'PRIVATE-TOKEN' })
    )
  })

  it("shows the server's reason when saving fails", async () => {
    setCredential.mockRejectedValue({ body: { detail: 'Add this index URL as a source first' } })
    const { onSaved } = renderDialog()
    fireEvent.change(screen.getByLabelText('addons.tokenLabel'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenSave' }))
    expect(await screen.findByText('Add this index URL as a source first')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('falls back to a generic message', async () => {
    setCredential.mockRejectedValue(null)
    renderDialog()
    fireEvent.change(screen.getByLabelText('addons.tokenLabel'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenSave' }))
    expect(await screen.findByText('addons.tokenSaveFailed')).toBeInTheDocument()
  })

  it('removes a saved token', async () => {
    clearCredential.mockResolvedValue({ source_credentials: {} } as never)
    const { onSaved } = renderDialog(saved)
    expect(screen.getByLabelText('addons.tokenLabel')).toHaveAttribute(
      'placeholder',
      'addons.tokenReplacePlaceholder'
    )
    fireEvent.click(screen.getByRole('button', { name: 'addons.tokenRemove' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({}))
    expect(clearCredential).toHaveBeenCalledWith(url)
  })

  it('offers no remove button when there is no token yet', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: 'addons.tokenRemove' })).not.toBeInTheDocument()
  })

  it('asks for an unreadable token again', () => {
    renderDialog({ ...saved, unreadable: true })
    expect(screen.getByRole('alert')).toHaveTextContent('addons.tokenUnreadable')
  })

  it('is read-only for a token pinned by the environment', () => {
    const { onClose } = renderDialog({ ...saved, env_locked: true })
    expect(screen.getByText('addons.tokenEnvLocked')).toBeInTheDocument()
    expect(screen.queryByLabelText('addons.tokenLabel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'addons.tokenRemove' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape and on a backdrop click', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores an empty submit', () => {
    renderDialog()
    fireEvent.submit(screen.getByLabelText('addons.tokenLabel').closest('form')!)
    expect(setCredential).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadPanel from './UploadPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const item = (over = {}) => ({
  id: over.name || 'i1',
  name: 'a.pdf',
  size: 2048,
  relativeDir: '',
  status: 'done',
  progress: 1,
  error: null,
  ...over,
})

function makeQueue(items) {
  const counts = items.reduce((acc, it) => ({ ...acc, [it.status]: (acc[it.status] || 0) + 1 }), {
    queued: 0,
    uploading: 0,
    done: 0,
    error: 0,
    cancelled: 0,
  })
  return {
    items,
    counts,
    inFlight: counts.queued + counts.uploading,
    retry: vi.fn(),
    retryFailed: vi.fn(),
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    clearCompleted: vi.fn(),
  }
}

describe('UploadPanel', () => {
  it('renders nothing when there is nothing to report', () => {
    const { container } = render(<UploadPanel queue={makeQueue([])} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows progress while uploads are in flight', () => {
    render(
      <UploadPanel
        queue={makeQueue([item({ status: 'uploading', progress: 0.4, name: 'big.pdf' })])}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/files\.uploadingCount/)).toBeInTheDocument()
    expect(screen.getByTestId('progress-big.pdf')).toHaveStyle({ width: '40%' })
  })

  it('names the file that failed and why', () => {
    render(
      <UploadPanel
        queue={makeQueue([
          item({ name: 'ok.pdf', status: 'done' }),
          item({ name: 'bad.mp3', status: 'error', error: 'Unsupported file type' }),
        ])}
        onClose={vi.fn()}
      />
    )
    // A bare "1 failed" would give the user nothing to act on.
    expect(screen.getByText('Unsupported file type')).toBeInTheDocument()
    expect(screen.getByTestId('upload-bad.mp3')).toBeInTheDocument()
  })

  it('retries one file', async () => {
    const queue = makeQueue([item({ name: 'bad.pdf', status: 'error', error: 'boom' })])
    render(<UploadPanel queue={queue} onClose={vi.fn()} />)

    await userEvent.click(screen.getByTestId('retry-bad.pdf'))
    expect(queue.retry).toHaveBeenCalledWith(['bad.pdf'])
  })

  it('retries every failure at once', async () => {
    const queue = makeQueue([
      item({ name: 'a.pdf', status: 'error', error: 'boom' }),
      item({ name: 'b.pdf', status: 'error', error: 'boom' }),
    ])
    render(<UploadPanel queue={queue} onClose={vi.fn()} />)

    await userEvent.click(screen.getByTestId('retry-all'))
    expect(queue.retryFailed).toHaveBeenCalled()
  })

  it('offers cancel only while work is outstanding', async () => {
    const queue = makeQueue([item({ name: 'big.pdf', status: 'uploading', progress: 0.2 })])
    render(<UploadPanel queue={queue} onClose={vi.fn()} />)

    await userEvent.click(screen.getByTestId('cancel-big.pdf'))
    expect(queue.cancel).toHaveBeenCalledWith('big.pdf')

    await userEvent.click(screen.getByTestId('cancel-all'))
    expect(queue.cancelAll).toHaveBeenCalled()
  })

  it('hides cancel and offers close once everything has settled', () => {
    render(<UploadPanel queue={makeQueue([item({ status: 'done' })])} onClose={vi.fn()} />)
    expect(screen.queryByTestId('cancel-all')).not.toBeInTheDocument()
    expect(screen.getByText(/files\.uploadFinished/)).toBeInTheDocument()
  })

  it('closes when dismissed', async () => {
    const onClose = vi.fn()
    render(<UploadPanel queue={makeQueue([item({ status: 'done' })])} onClose={onClose} />)
    await userEvent.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a folder upload with its sub-path', () => {
    render(
      <UploadPanel
        queue={makeQueue([item({ name: 'phb.pdf', relativeDir: 'Core/2024', status: 'queued' })])}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Core/2024/phb.pdf')).toBeInTheDocument()
  })
})

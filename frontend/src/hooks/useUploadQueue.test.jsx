import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useUploadQueue from './useUploadQueue'

// A controllable XMLHttpRequest stand-in: jsdom has no real one that uploads,
// and the queue's whole contract is what it does with load/error/abort.
const sockets = []

class FakeXHR {
  constructor() {
    this.upload = {}
    this.status = 0
    this.responseText = ''
    this.headers = {}
    sockets.push(this)
  }
  open(method, url) {
    this.method = method
    this.url = url
  }
  setRequestHeader(k, v) {
    this.headers[k] = v
  }
  send(body) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  // Test helpers.
  succeed(name = 'x.pdf') {
    this.status = 200
    this.responseText = JSON.stringify({ name, path: `books/${name}`, size: 1 })
    this.onload()
  }
  fail(status = 400, detail = 'Unsupported file type') {
    this.status = status
    this.responseText = JSON.stringify({ detail })
    this.onload()
  }
  networkError() {
    this.onerror()
  }
  progress(loaded, total) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
}

const mkFile = (name, size = 10) => {
  const f = new File(['x'.repeat(size)], name, { type: 'application/pdf' })
  return f
}

beforeEach(() => {
  sockets.length = 0
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  localStorage.setItem('grimoire_token', 'tok')
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('useUploadQueue', () => {
  it('starts queued uploads and reports them as done', async () => {
    const { result } = renderHook(() => useUploadQueue())

    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books/System')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(result.current.items[0].status).toBe('uploading')

    act(() => sockets[0].succeed('a.pdf'))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(result.current.counts.done).toBe(1)
  })

  it('sends the destination and relative directory with each file', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('phb.pdf'), relativeDir: 'Core/2024' }], 'books/DnD')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))

    const body = sockets[0].body
    expect(body.get('destination')).toBe('books/DnD')
    // A dropped folder keeps its shape via this path.
    expect(body.get('relative_dir')).toBe('Core/2024')
    // Uploads never overwrite; a clash lands under a suffixed name.
    expect(body.get('on_conflict')).toBe('rename')
  })

  it('authenticates the request', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(sockets[0].headers.Authorization).toBe('Bearer tok')
  })

  it('limits how many upload at once', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue(
        Array.from({ length: 7 }, (_, i) => ({ file: mkFile(`f${i}.pdf`) })),
        'books'
      )
    })
    // A large import must not open a socket per file.
    await waitFor(() => expect(sockets).toHaveLength(3))
    expect(result.current.counts.queued).toBe(4)

    act(() => sockets[0].succeed())
    await waitFor(() => expect(sockets).toHaveLength(4))
  })

  it('tracks per-file progress', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('big.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => sockets[0].progress(50, 200))
    await waitFor(() => expect(result.current.items[0].progress).toBeCloseTo(0.25))
  })

  it('keeps a failure attributable to its file, with the reason', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('good.pdf') }, { file: mkFile('bad.mp3') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(2))

    act(() => sockets[0].succeed('good.pdf'))
    act(() => sockets[1].fail(400, 'Unsupported file type'))

    await waitFor(() => expect(result.current.counts.error).toBe(1))
    const bad = result.current.items.find((i) => i.name === 'bad.mp3')
    // The whole point of per-file requests: one failure does not sink the batch,
    // and the user is told which file and why.
    expect(bad.status).toBe('error')
    expect(bad.error).toBe('Unsupported file type')
    expect(result.current.items.find((i) => i.name === 'good.pdf').status).toBe('done')
  })

  it('reports a network failure without a response body', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => sockets[0].networkError())
    await waitFor(() => expect(result.current.items[0].error).toBe('Network error'))
  })

  it('retries a single failed file', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))
    act(() => sockets[0].fail(500, 'Server error'))
    await waitFor(() => expect(result.current.items[0].status).toBe('error'))

    const id = result.current.items[0].id
    act(() => result.current.retry([id]))

    await waitFor(() => expect(sockets).toHaveLength(2))
    act(() => sockets[1].succeed('a.pdf'))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(result.current.counts.error).toBe(0)
  })

  it('retries every failed file at once, leaving successes alone', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue(
        [{ file: mkFile('a.pdf') }, { file: mkFile('b.pdf') }, { file: mkFile('c.pdf') }],
        'books'
      )
    })
    await waitFor(() => expect(sockets).toHaveLength(3))

    act(() => {
      sockets[0].succeed('a.pdf')
      sockets[1].fail(500, 'boom')
      sockets[2].fail(500, 'boom')
    })
    await waitFor(() => expect(result.current.counts.error).toBe(2))

    act(() => result.current.retryFailed())
    // Only the two failures are resent — a completed upload is not repeated.
    await waitFor(() => expect(sockets).toHaveLength(5))
    expect(result.current.counts.done).toBe(1)
  })

  it('cancels an in-flight upload', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => result.current.cancel(result.current.items[0].id))
    await waitFor(() => expect(result.current.items[0].status).toBe('cancelled'))
  })

  it('cancels a file that has not started yet', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue(
        Array.from({ length: 5 }, (_, i) => ({ file: mkFile(`f${i}.pdf`) })),
        'books'
      )
    })
    await waitFor(() => expect(sockets).toHaveLength(3))

    const pending = result.current.items.find((i) => i.status === 'queued')
    act(() => result.current.cancel(pending.id))

    await waitFor(() =>
      expect(result.current.items.find((i) => i.id === pending.id).status).toBe('cancelled')
    )
    // It was never sent.
    expect(sockets).toHaveLength(3)
  })

  it('a cancelled upload can be retried', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))
    act(() => result.current.cancel(result.current.items[0].id))
    await waitFor(() => expect(result.current.items[0].status).toBe('cancelled'))

    act(() => result.current.retry([result.current.items[0].id]))
    await waitFor(() => expect(sockets).toHaveLength(2))
  })

  it('clears finished rows but keeps failures needing attention', async () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }, { file: mkFile('b.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(2))
    act(() => {
      sockets[0].succeed('a.pdf')
      sockets[1].fail(400, 'nope')
    })
    await waitFor(() => expect(result.current.counts.done).toBe(1))

    act(() => result.current.clearCompleted())
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0].status).toBe('error')
  })

  it('notifies the caller as each file finishes', async () => {
    const onFileDone = vi.fn()
    const { result } = renderHook(() => useUploadQueue({ onFileDone }))
    act(() => {
      result.current.enqueue([{ file: mkFile('a.pdf') }], 'books')
    })
    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => sockets[0].succeed('a.pdf'))
    // Lets the view refresh so an uploaded file appears without a manual reload.
    await waitFor(() => expect(onFileDone).toHaveBeenCalled())
  })

  it('ignores an empty selection', () => {
    const { result } = renderHook(() => useUploadQueue())
    act(() => {
      result.current.enqueue([], 'books')
    })
    expect(result.current.items).toHaveLength(0)
    expect(sockets).toHaveLength(0)
  })
})

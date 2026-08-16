import { useCallback, useRef, useState } from 'react'

// How many uploads run at once. Enough to keep a fast link busy without opening
// so many sockets that a large import starves the rest of the app — and each one
// streams a whole file, so the browser's per-host connection limit is the real
// ceiling anyway.
const CONCURRENCY = 3

let nextId = 0

/**
 * A queue of file uploads with per-file status, progress, and retry.
 *
 * Uploads are sent one request per file rather than one request per batch. A
 * batch request would make 200 files succeed or fail together, and a failure at
 * file 40 would leave the user with no idea which ones landed. Per-file requests
 * mean a failure is isolated, attributable, and retryable on its own.
 *
 * `XMLHttpRequest` rather than `fetch`, solely because it reports upload
 * progress — `fetch` has no equivalent for request bodies in any shipping
 * browser, and a multi-hundred-megabyte book with no progress bar looks hung.
 */
export function useUploadQueue({ onFileDone } = {}) {
  const [items, setItems] = useState([])
  const active = useRef(new Map()) // id -> XMLHttpRequest
  const queue = useRef([])
  const running = useRef(0)
  const doneCb = useRef(onFileDone)
  doneCb.current = onFileDone

  const patch = useCallback((id, changes) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  const send = useCallback(
    (item) => {
      const xhr = new XMLHttpRequest()
      active.current.set(item.id, xhr)
      patch(item.id, { status: 'uploading', progress: 0, error: null })

      const form = new FormData()
      form.append('destination', item.destination)
      form.append('relative_dir', item.relativeDir || '')
      form.append('on_conflict', 'rename')
      form.append('file', item.file, item.name)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patch(item.id, { progress: e.loaded / e.total })
      }

      xhr.onload = () => {
        active.current.delete(item.id)
        if (xhr.status >= 200 && xhr.status < 300) {
          let landedAs = item.name
          try {
            landedAs = JSON.parse(xhr.responseText)?.name || item.name
          } catch {
            // A success with an unparseable body still moved the file; the name
            // is cosmetic here.
          }
          patch(item.id, { status: 'done', progress: 1, landedAs })
        } else {
          let detail = `Upload failed (${xhr.status})`
          try {
            detail = JSON.parse(xhr.responseText)?.detail || detail
          } catch {
            /* keep the status-based message */
          }
          patch(item.id, { status: 'error', error: detail })
        }
        doneCb.current?.()
        running.current -= 1
        pump()
      }

      xhr.onerror = () => {
        active.current.delete(item.id)
        // A network-level failure carries no body; say so plainly rather than
        // reporting an empty error.
        patch(item.id, { status: 'error', error: 'Network error' })
        running.current -= 1
        pump()
      }

      xhr.onabort = () => {
        active.current.delete(item.id)
        patch(item.id, { status: 'cancelled', error: null })
        running.current -= 1
        pump()
      }

      xhr.open('POST', '/api/files/upload')
      const token = localStorage.getItem('grimoire_token')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.send(form)
    },
    [patch]
  )

  // Start as many queued uploads as the concurrency budget allows.
  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const item = queue.current.shift()
      running.current += 1
      send(item)
    }
  }, [send])

  /**
   * Add files to the queue.
   *
   * `entries` is `[{ file, relativeDir }]` — `relativeDir` comes from a folder
   * drop (`webkitRelativePath` minus the file name) and is empty for a plain
   * file selection.
   */
  const enqueue = useCallback(
    (entries, destination) => {
      const added = entries.map(({ file, relativeDir }) => ({
        id: `u${nextId++}`,
        file,
        name: file.name,
        size: file.size,
        relativeDir: relativeDir || '',
        destination,
        status: 'queued',
        progress: 0,
        error: null,
      }))
      setItems((prev) => [...prev, ...added])
      queue.current.push(...added)
      pump()
      return added.length
    },
    [pump]
  )

  /** Re-queue the failed items, keeping their place in the list. */
  const retry = useCallback(
    (ids) => {
      setItems((prev) => {
        const targets = prev.filter(
          (it) => ids.includes(it.id) && (it.status === 'error' || it.status === 'cancelled')
        )
        queue.current.push(...targets.map((it) => ({ ...it, status: 'queued' })))
        return prev.map((it) =>
          targets.some((t) => t.id === it.id)
            ? { ...it, status: 'queued', progress: 0, error: null }
            : it
        )
      })
      // Deferred so the state above is applied before the requests fire.
      setTimeout(pump, 0)
    },
    [pump]
  )

  const retryFailed = useCallback(() => {
    setItems((prev) => {
      const failed = prev.filter((it) => it.status === 'error' || it.status === 'cancelled')
      queue.current.push(...failed.map((it) => ({ ...it, status: 'queued' })))
      setTimeout(pump, 0)
      return prev.map((it) =>
        it.status === 'error' || it.status === 'cancelled'
          ? { ...it, status: 'queued', progress: 0, error: null }
          : it
      )
    })
  }, [pump])

  const cancel = useCallback((id) => {
    const xhr = active.current.get(id)
    if (xhr) {
      xhr.abort()
      return
    }
    // Not yet started: drop it from the pending queue.
    queue.current = queue.current.filter((it) => it.id !== id)
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.status === 'queued' ? { ...it, status: 'cancelled' } : it
      )
    )
  }, [])

  const cancelAll = useCallback(() => {
    queue.current = []
    active.current.forEach((xhr) => xhr.abort())
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'queued' || it.status === 'uploading' ? { ...it, status: 'cancelled' } : it
      )
    )
  }, [])

  /** Drop finished rows, keeping anything still in flight or needing attention. */
  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'done'))
  }, [])

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1
      return acc
    },
    { queued: 0, uploading: 0, done: 0, error: 0, cancelled: 0 }
  )
  const inFlight = counts.queued + counts.uploading

  return {
    items,
    counts,
    inFlight,
    enqueue,
    retry,
    retryFailed,
    cancel,
    cancelAll,
    clearCompleted,
  }
}

export default useUploadQueue

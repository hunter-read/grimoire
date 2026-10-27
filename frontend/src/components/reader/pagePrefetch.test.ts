import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openingMode,
  openingPageUrls,
  prefetchInBackground,
  prefetchNow,
  resetPrefetchForTests,
} from './pagePrefetch'

// Stands in for the browser's Image: records each load so a test can see what
// was requested, at what priority, and finish it when it chooses.
class FakeImage {
  static all: FakeImage[] = []
  src = ''
  decoding = ''
  fetchPriority = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeImage.all.push(this)
  }
  finish() {
    this.onload?.()
  }
}

const srcs = () => FakeImage.all.map((i) => i.src)
const pdf = { id: 'b1', content_token: 'tok', mime_type: 'application/pdf', page_count: 100 }
const page = (n: number, width = 1600) => `/api/books/b1/page/${n}?width=${width}&v=tok`

let idle: (() => void)[] = []
const runIdle = () => {
  const due = idle
  idle = []
  due.forEach((fn) => fn())
}

beforeEach(() => {
  FakeImage.all = []
  idle = []
  resetPrefetchForTests()
  localStorage.clear()
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => idle.push(fn))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const setPrefs = (user: object, book: object = {}) => {
  localStorage.setItem('grimoire:user-prefs', JSON.stringify(user))
  localStorage.setItem('grimoire:book:b1', JSON.stringify(book))
}

// Fake setTimeout only: the idle callback stays the stub runIdle drives.
const onlyTimeouts = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

const onPhone = (phone: boolean) =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation((q: string) => ({ matches: phone, media: q }) as MediaQueryList)

describe('openingMode', () => {
  it('defaults to single pages', () => {
    expect(openingMode('b1')).toBe('page')
  })

  it('takes the global reader mode over the book’s own', () => {
    setPrefs({ readerMode: 'spread' }, { mode: 'pdf' })
    expect(openingMode('b1')).toBe('spread')
  })

  it('falls back to the book’s own mode', () => {
    setPrefs({}, { mode: 'spread' })
    expect(openingMode('b1')).toBe('spread')
  })

  it('ignores a mode it does not know', () => {
    setPrefs({ readerMode: 'scroll' }, { mode: 'carousel' })
    expect(openingMode('b1')).toBe('page')
  })

  it('reads single pages on a phone whatever the prefs say', () => {
    onPhone(true)
    setPrefs({ readerMode: 'spread' })
    expect(openingMode('b1')).toBe('page')
  })
})

describe('openingPageUrls', () => {
  it('is the reader’s single-page URL, content token included', () => {
    expect(openingPageUrls(pdf, 12)).toEqual([page(12)])
  })

  it('opens where the reader left off when no page is given', () => {
    setPrefs({}, { page: 40 })
    expect(openingPageUrls(pdf)).toEqual([page(40)])
    expect(openingPageUrls(pdf, null)).toEqual([page(40)])
  })

  it('starts on page 1 with no page and no saved place', () => {
    expect(openingPageUrls(pdf)).toEqual([page(1)])
  })

  it('stops at the last page, as the reader does', () => {
    expect(openingPageUrls(pdf, 500)).toEqual([page(100)])
  })

  it('leaves the token off when the book has none', () => {
    expect(openingPageUrls({ id: 'b1' }, 3)).toEqual(['/api/books/b1/page/3?width=1600'])
  })

  it('loads both pages of a spread at the spread width', () => {
    setPrefs({ readerMode: 'spread' })
    expect(openingPageUrls(pdf, 12)).toEqual([page(12, 1000), page(13, 1000)])
  })

  it('shows a cover on its own in a spread', () => {
    setPrefs({ readerMode: 'spread' })
    expect(openingPageUrls(pdf, 1)).toEqual([page(1, 1000)])
  })

  it('pairs the cover when the spread offset makes it a left page', () => {
    setPrefs({ readerMode: 'spread' }, { spreadOffset: 1 })
    expect(openingPageUrls(pdf, 1)).toEqual([page(1, 1000), page(2, 1000)])
  })

  it('has no facing page after the last', () => {
    setPrefs({ readerMode: 'spread' })
    expect(openingPageUrls(pdf, 100)).toEqual([page(100, 1000)])
  })

  it('loads nothing for the browser’s own PDF viewer', () => {
    setPrefs({ readerMode: 'pdf' })
    expect(openingPageUrls(pdf, 3)).toEqual([])
  })

  it.each([
    ['a text document', { mime_type: 'text/markdown' }],
    ['a single image', { mime_type: 'image/png' }],
    ['an archive', { mime_type: 'application/zip', filename: 'maps.zip' }],
  ])('loads nothing for %s, which has no page images', (_label, fields) => {
    expect(openingPageUrls({ id: 'b1', ...fields }, 1)).toEqual([])
  })

  it('pages a comic archive like any other book', () => {
    const comic = { id: 'b1', mime_type: 'application/zip', filename: 'issue1.cbz' }
    expect(openingPageUrls(comic, 2)).toEqual(['/api/books/b1/page/2?width=1600'])
  })
})

describe('prefetchInBackground', () => {
  it('waits for the browser to be idle, then loads at low priority', () => {
    prefetchInBackground([page(1)])
    expect(FakeImage.all).toHaveLength(0)
    runIdle()
    expect(srcs()).toEqual([page(1)])
    expect(FakeImage.all[0].fetchPriority).toBe('low')
    expect(FakeImage.all[0].decoding).toBe('async')
  })

  it('loads two at a time, starting the next as one finishes', () => {
    prefetchInBackground([page(1), page(2), page(3)])
    runIdle()
    expect(srcs()).toEqual([page(1), page(2)])
    FakeImage.all[0].finish()
    runIdle()
    expect(srcs()).toEqual([page(1), page(2), page(3)])
  })

  it('backs off after a page that fails to load, then tries it again', () => {
    onlyTimeouts()
    prefetchInBackground([page(1), page(2), page(3)])
    runIdle()
    FakeImage.all[1].onerror?.()
    runIdle()
    // The server may be busy: the failed page keeps its slot for a while.
    expect(srcs()).toEqual([page(1), page(2)])
    vi.advanceTimersByTime(2000)
    runIdle()
    expect(srcs()).toEqual([page(1), page(2), page(3)])
    FakeImage.all[0].finish()
    runIdle()
    expect(srcs()).toEqual([page(1), page(2), page(3), page(2)])
    vi.useRealTimers()
  })

  it('gives up on a page after a few tries, and a later link may ask again', () => {
    onlyTimeouts()
    prefetchInBackground([page(1)])
    for (let i = 0; i < 3; i++) {
      runIdle()
      FakeImage.all[i].onerror?.()
      vi.advanceTimersByTime(2000)
    }
    runIdle()
    expect(srcs()).toEqual([page(1), page(1), page(1)])
    prefetchInBackground([page(1)])
    runIdle()
    expect(srcs()).toHaveLength(4)
    vi.useRealTimers()
  })

  it('does not retry a page cancelled while it was failing', () => {
    onlyTimeouts()
    const cancel = prefetchInBackground([page(1)])
    runIdle()
    FakeImage.all[0].onerror?.()
    cancel()
    vi.advanceTimersByTime(2000)
    runIdle()
    expect(srcs()).toEqual([page(1)])
    vi.useRealTimers()
  })

  it('asks for a page once, however often it is linked', () => {
    prefetchInBackground([page(1)])
    prefetchInBackground([page(1)])
    runIdle()
    expect(srcs()).toEqual([page(1)])
  })

  it('drops the pages not yet started when cancelled', () => {
    const cancel = prefetchInBackground([page(1), page(2), page(3)])
    runIdle()
    cancel()
    FakeImage.all[0].finish()
    runIdle()
    expect(srcs()).toEqual([page(1), page(2)])
    // A cancelled page is not remembered, so a later note can still ask for it.
    prefetchInBackground([page(3)])
    runIdle()
    expect(srcs()).toEqual([page(1), page(2), page(3)])
  })

  it('falls back to a timer without requestIdleCallback', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    prefetchInBackground([page(1)])
    expect(FakeImage.all).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(srcs()).toEqual([page(1)])
    vi.useRealTimers()
  })

  it('does nothing when the user is saving data', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    const cancel = prefetchInBackground([page(1)])
    runIdle()
    expect(FakeImage.all).toHaveLength(0)
    expect(cancel).not.toThrow()
  })
})

describe('prefetchNow', () => {
  it('loads straight away at normal priority', () => {
    prefetchNow([page(1)])
    expect(srcs()).toEqual([page(1)])
    expect(FakeImage.all[0].fetchPriority).toBe('auto')
  })

  it('does not load a page twice', () => {
    prefetchNow([page(1)])
    prefetchNow([page(1)])
    expect(srcs()).toEqual([page(1)])
  })

  it('pulls a page forward from the background queue', () => {
    prefetchInBackground([page(1), page(2), page(3)])
    runIdle()
    prefetchNow([page(3)])
    expect(srcs()).toEqual([page(1), page(2), page(3)])
    FakeImage.all[0].finish()
    runIdle()
    // Already loaded, so the queue has nothing left to start.
    expect(srcs()).toHaveLength(3)
  })

  it('leaves a background page that is already loading alone', () => {
    prefetchInBackground([page(1)])
    runIdle()
    prefetchNow([page(1)])
    expect(srcs()).toEqual([page(1)])
  })

  it('asks again for a page that failed to load', () => {
    prefetchNow([page(1)])
    FakeImage.all[0].onerror?.()
    prefetchNow([page(1)])
    expect(srcs()).toEqual([page(1), page(1)])
  })

  it('forgets the oldest pages past its memory', () => {
    for (let n = 1; n <= 501; n++) prefetchNow([page(n)])
    prefetchNow([page(1)])
    expect(srcs().filter((s) => s === page(1))).toHaveLength(2)
  })
})

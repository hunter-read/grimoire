// Warm the page images the reader will ask for before it is opened (issue #640).
//
// A page renders on its first request, and a cold render is the slow part of
// opening a book link. Loading the page early - while a campaign note that
// links to it is on screen, or while a search hit is hovered - makes the render
// happen before the click rather than after it. That fills the server's render
// cache, and the browser's too: page images are cached `immutable`, so the
// reader's request is answered without a round trip, provided it asks for the
// same URL. Hence openingPageUrls, which predicts the exact URLs ReaderView
// requests first: same page, same width, same content token.

import { bookPageUrl } from '../../api'
import { isArchiveBook, isSingleImageBook, isTextBook } from '../../constants'
import { getBookPrefs } from '../../hooks/useBookPrefs'
import { getUserPrefs } from '../../hooks/useUserPrefs'
import { PAGE_WIDTH, SPREAD_WIDTH } from './pageRender'

/** The book fields it takes to predict the reader's first page requests. */
export interface PrefetchableBook {
  id: string
  content_token?: string | null
  mime_type?: string | null
  filename?: string | null
  page_count?: number | null
}

type ReaderMode = 'page' | 'spread' | 'pdf'
const MODES: readonly string[] = ['page', 'spread', 'pdf']
const isMode = (m: unknown): m is ReaderMode => typeof m === 'string' && MODES.includes(m)

// ReaderView reads in single pages below this width, whatever the prefs say.
const PHONE_BREAKPOINT = 640

/**
 * The view mode ReaderView opens `bookId` in from a link without `?view=`.
 * Mirrors its `initialMode`: keep the two in step, or prefetches warm a width
 * the reader never asks for.
 */
export function openingMode(bookId: string): ReaderMode {
  const phone =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.(`(max-width: ${PHONE_BREAKPOINT - 1}px)`).matches
  if (phone) return 'page'
  const global: unknown = getUserPrefs().readerMode
  if (isMode(global)) return global
  const own: unknown = getBookPrefs(bookId).mode
  return isMode(own) ? own : 'page'
}

/**
 * The page image URLs ReaderView requests first when `book` is opened at
 * `page` (or, with no page, where the reader left off). Empty for books the
 * reader shows without page images: text documents, single images, archives,
 * and the browser's own PDF viewer.
 */
export function openingPageUrls(book: PrefetchableBook, page?: number | null): string[] {
  if (isSingleImageBook(book) || isTextBook(book) || isArchiveBook(book)) return []
  const mode = openingMode(book.id)
  if (mode === 'pdf') return []
  const prefs = getBookPrefs(book.id)
  const last = book.page_count || 0
  // The reader opens past-the-end pages on the last one (issue #497).
  let p = page || Number(prefs.page) || 1
  if (last > 0) p = Math.min(p, last)
  const url = (n: number, width: number) => bookPageUrl(book.id, n, width, book.content_token)
  if (mode === 'page') return [url(p, PAGE_WIDTH)]
  // A spread shows the facing page too, except for a cover that stands alone.
  const urls = [url(p, SPREAD_WIDTH)]
  const offset = prefs.spreadOffset ?? 0
  if ((offset === 1 || p !== 1) && p + 1 <= last) urls.push(url(p + 1, SPREAD_WIDTH))
  return urls
}

// Background prefetches in flight at once. Each one is a render on the server,
// competing with whatever the user is actually reading, so a note with a dozen
// links warms them a couple at a time rather than all together.
const MAX_BACKGROUND = 2
// URLs already asked for, so a page is fetched once however many times it is
// linked or hovered. Bounded so a long session doesn't grow it forever; a URL
// that ages out is at worst fetched again, from the browser cache.
const REMEMBERED_MAX = 500

const requested = new Set<string>()
const queue: string[] = []
// Holds each loading Image so it isn't collected before its request lands.
const loading = new Set<HTMLImageElement>()
let backgroundActive = 0
let pumpScheduled = false

function remember(url: string): void {
  requested.add(url)
  if (requested.size > REMEMBERED_MAX) {
    const oldest = requested.values().next().value
    if (oldest !== undefined) requested.delete(oldest)
  }
}

// An Image rather than fetch(): while it is still loading, the reader's <img>
// for the same URL joins that load instead of starting a second one, and the
// result lands in the image cache the reader reads from.
function load(url: string, priority: 'low' | 'auto', onSettled?: () => void): void {
  const img = new Image()
  img.decoding = 'async'
  img.fetchPriority = priority
  img.onload = img.onerror = () => {
    loading.delete(img)
    onSettled?.()
  }
  loading.add(img)
  img.src = url
}

function whenIdle(fn: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 2000 })
  } else {
    setTimeout(fn, 200)
  }
}

function pump(): void {
  while (backgroundActive < MAX_BACKGROUND && queue.length > 0) {
    const url = queue.shift() as string
    backgroundActive++
    load(url, 'low', () => {
      backgroundActive--
      schedulePump()
    })
  }
}

function schedulePump(): void {
  if (pumpScheduled || queue.length === 0) return
  pumpScheduled = true
  whenIdle(() => {
    pumpScheduled = false
    pump()
  })
}

// The user asked the browser to save data; background guesses can wait.
function savingData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return !!nav.connection?.saveData
}

/**
 * Warm `urls` in the background: at low priority, a few at a time, when the
 * browser is idle. Returns a cancel that drops the ones not yet started - call
 * it when whatever linked them leaves the screen.
 */
export function prefetchInBackground(urls: string[]): () => void {
  if (savingData()) return () => {}
  const queued = urls.filter((u) => !requested.has(u))
  for (const u of queued) {
    remember(u)
    queue.push(u)
  }
  schedulePump()
  return () => {
    for (const u of queued) {
      const i = queue.indexOf(u)
      if (i === -1) continue
      queue.splice(i, 1)
      requested.delete(u)
    }
  }
}

/**
 * Load `urls` now, at normal priority: the user is about to open them. A URL
 * still waiting in the background queue is pulled forward rather than fetched
 * twice; one already loading or loaded is left alone.
 */
export function prefetchNow(urls: string[]): void {
  for (const u of urls) {
    if (requested.has(u)) {
      const i = queue.indexOf(u)
      if (i === -1) continue
      queue.splice(i, 1)
    } else {
      remember(u)
    }
    load(u, 'auto')
  }
}

/** Forget every prefetch. Tests only: the module state is otherwise app-wide. */
export function resetPrefetchForTests(): void {
  requested.clear()
  queue.length = 0
  loading.clear()
  backgroundActive = 0
  pumpScheduled = false
}

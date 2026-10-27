/** Per-book (or per-map, keyed `map:<id>`) reader state kept in localStorage. */
export interface BookPrefs {
  /** Last page read; null once progress is reset. */
  page?: number | null
  /** Reader mode chosen for this book. */
  mode?: string
  spreadOffset?: number
  joinSpread?: boolean
  /** Anything else a reader stores per book. */
  [key: string]: unknown
}

/** An entry in the recently-opened list. */
export interface RecentBook {
  id: string
  title: string
  has_thumbnail?: boolean | null
  page_count?: number | null
  openedAt: number
}

const key = (bookId: string) => `grimoire:book:${bookId}`

function read(bookId: string): BookPrefs {
  try {
    const raw = localStorage.getItem(key(bookId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(bookId: string, updates: Partial<BookPrefs>): void {
  try {
    localStorage.setItem(key(bookId), JSON.stringify({ ...read(bookId), ...updates }))
  } catch {}
}

export function getBookPrefs(bookId: string): BookPrefs {
  return read(bookId)
}

export function saveBookPrefs(bookId: string, updates: Partial<BookPrefs>): void {
  write(bookId, updates)
}

const RECENT_KEY = 'grimoire:recently-opened'

export const RECENT_DEFAULT = 5
export const RECENT_MAX = 100

// Reads the user's configured recently-opened limit, clamped to [0, RECENT_MAX].
// 0 disables the feature entirely.
export function getRecentLimit(): number {
  try {
    const raw = localStorage.getItem('grimoire:user-prefs')
    const prefs = raw ? JSON.parse(raw) : {}
    const limit = prefs.recentLimit
    if (typeof limit !== 'number' || Number.isNaN(limit)) return RECENT_DEFAULT
    return Math.max(0, Math.min(RECENT_MAX, Math.floor(limit)))
  } catch {
    return RECENT_DEFAULT
  }
}

export function saveRecentBook(book: Omit<RecentBook, 'openedAt'>): void {
  const limit = getRecentLimit()
  if (limit <= 0) return
  try {
    const list = getRecentBooks().filter((b) => b.id !== book.id)
    list.unshift({
      id: book.id,
      title: book.title,
      has_thumbnail: book.has_thumbnail,
      page_count: book.page_count,
      openedAt: Date.now(),
    })
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, limit)))
  } catch {}
}

export function getRecentBooks(): RecentBook[] {
  const limit = getRecentLimit()
  if (limit <= 0) return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list: RecentBook[] = raw ? JSON.parse(raw) : []
    return list.slice(0, limit)
  } catch {
    return []
  }
}

export function removeRecentBook(bookId: string): void {
  try {
    const list = getRecentBooks().filter((b) => b.id !== bookId)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {}
}

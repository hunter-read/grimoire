const key = (bookId) => `grimoire:book:${bookId}`

function read(bookId) {
  try {
    const raw = localStorage.getItem(key(bookId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(bookId, updates) {
  try {
    localStorage.setItem(key(bookId), JSON.stringify({ ...read(bookId), ...updates }))
  } catch {}
}

export function getBookPrefs(bookId) {
  return read(bookId)
}

export function saveBookPrefs(bookId, updates) {
  write(bookId, updates)
}

const RECENT_KEY = 'grimoire:recently-opened'
const RECENT_MAX = 10

export function saveRecentBook(book) {
  try {
    const list = getRecentBooks().filter((b) => b.id !== book.id)
    list.unshift({
      id: book.id,
      title: book.title,
      has_thumbnail: book.has_thumbnail,
      page_count: book.page_count,
      openedAt: Date.now(),
    })
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {}
}

export function getRecentBooks() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

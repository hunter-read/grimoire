import '@testing-library/jest-dom'
import '../i18n'

// Node.js 22+ has a native localStorage/sessionStorage that lacks clear() and
// doesn't reset between tests. Replace both with proper in-memory implementations.
function makeStorageMock() {
  let _store = {}
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null),
    setItem: (key, val) => {
      _store[key] = String(val)
    },
    removeItem: (key) => {
      delete _store[key]
    },
    clear: () => {
      _store = {}
    },
    get length() {
      return Object.keys(_store).length
    },
    key: (i) => Object.keys(_store)[i] ?? null,
  }
}
const localStorageMock = makeStorageMock()
const sessionStorageMock = makeStorageMock()
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
})

// jsdom doesn't implement matchMedia — provide a stub that always returns false.
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Clear storage before each test so state never leaks between tests.
beforeEach(() => {
  localStorageMock.clear()
  sessionStorageMock.clear()
})

// jsdom has no IntersectionObserver. The paged browse views load each page when
// a LoadMoreSentinel scrolls into view (issue #221); in a layout-less test
// every sentinel counts as on screen the moment it is observed, the way a short
// list's end is in a real browser, so lists load in full. A test can replace
// this global to drive the observer itself (see LogsTab.test.jsx).
class VisibleIntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe(target) {
    queueMicrotask(() => this.callback?.([{ isIntersecting: true, target }], this))
  }
  unobserve() {}
  disconnect() {
    this.callback = null
  }
  takeRecords() {
    return []
  }
}
globalThis.IntersectionObserver = VisibleIntersectionObserver

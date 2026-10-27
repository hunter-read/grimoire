import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import '../i18n'
import { trackTimers } from './pendingTimers'

// The default 1s findBy/waitFor timeout flakes on a loaded CI runner running
// the whole suite under coverage; a passing wait returns as soon as it holds.
configure({ asyncUtilTimeout: 3000 })

// Cancel the timers a file leaves pending once its tests are done, so none can
// fire into the torn-down environment and fail the run (see pendingTimers.ts).
afterAll(trackTimers())

// Node.js 22+ has a native localStorage/sessionStorage that lacks clear() and
// doesn't reset between tests. Replace both with proper in-memory implementations.
function makeStorageMock(): Storage {
  let _store: Record<string, string> = {}
  return {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null,
    setItem: (key: string, val: unknown) => {
      _store[key] = String(val)
    },
    removeItem: (key: string) => {
      delete _store[key]
    },
    clear: () => {
      _store = {}
    },
    get length() {
      return Object.keys(_store).length
    },
    key: (i: number) => Object.keys(_store)[i] ?? null,
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
  value: (query: string) => ({
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
  callback: IntersectionObserverCallback | null
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback?.(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      )
    )
  }
  unobserve() {}
  disconnect() {
    this.callback = null
  }
  takeRecords() {
    return []
  }
}
// Only the members the views use; the rest of the interface is never read.
globalThis.IntersectionObserver =
  VisibleIntersectionObserver as unknown as typeof IntersectionObserver

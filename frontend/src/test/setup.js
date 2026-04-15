import '@testing-library/jest-dom'
import '../i18n'

// Node.js 22+ has a native localStorage that lacks clear() and doesn't reset
// between tests. Replace it with a proper in-memory implementation for all tests.
let _store = {}
const localStorageMock = {
  getItem:    (key)       => Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null,
  setItem:    (key, val)  => { _store[key] = String(val) },
  removeItem: (key)       => { delete _store[key] },
  clear:      ()          => { _store = {} },
  get length()            { return Object.keys(_store).length },
  key:        (i)         => Object.keys(_store)[i] ?? null,
}
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
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

// Clear localStorage before each test so state never leaks between tests.
beforeEach(() => {
  localStorageMock.clear()
})

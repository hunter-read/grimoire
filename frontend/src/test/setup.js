import '@testing-library/jest-dom'
import '../i18n'

// Node.js 22+ has a native localStorage/sessionStorage that lacks clear() and
// doesn't reset between tests. Replace both with proper in-memory implementations.
function makeStorageMock() {
  let _store = {}
  return {
    getItem:    (key)       => Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null,
    setItem:    (key, val)  => { _store[key] = String(val) },
    removeItem: (key)       => { delete _store[key] },
    clear:      ()          => { _store = {} },
    get length()            { return Object.keys(_store).length },
    key:        (i)         => Object.keys(_store)[i] ?? null,
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

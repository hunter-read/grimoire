import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useSortFilterState, { DEFAULT_SORT_FILTER } from './useSortFilterState'

const KEY = 'grimoire:test:sortFilter'

const preset = { sort: 'size', order: 'desc', filters: {} }
const savedWith = (defaultFilter, loaded = true) => ({ loaded, defaultFilter })

/**
 * Render the hook as one of two arrivals:
 *  - fresh:    navigated in from anywhere else (no restoreView flag)
 *  - returned: the in-app back button, which carries `restoreView`
 *
 * Driving the real router state rather than mocking useRestoredView keeps the
 * test honest about the thing that actually distinguishes the two cases.
 */
function renderAt(saved, { returned = false } = {}) {
  const entry = returned ? { pathname: '/library', state: { restoreView: true } } : '/library'
  return renderHook(({ s }) => useSortFilterState(KEY, s), {
    initialProps: { s: saved },
    wrapper: ({ children }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>,
  })
}

beforeEach(() => sessionStorage.clear())

describe('useSortFilterState', () => {
  it('starts from the built-in default when nothing is stored', () => {
    const { result } = renderAt(savedWith(null))
    expect(result.current[0]).toEqual(DEFAULT_SORT_FILTER)
  })

  it('applies the saved default preset on a fresh arrival', async () => {
    const { result } = renderAt(savedWith({ id: 'd', state: preset }))
    await waitFor(() => expect(result.current[0]).toEqual(preset))
  })

  it('waits for the presets to load before applying a default', async () => {
    const { result, rerender } = renderAt(savedWith(null, false))
    // Nothing has loaded, so the default preset cannot be known yet.
    expect(result.current[0]).toEqual(DEFAULT_SORT_FILTER)

    rerender({ s: savedWith({ id: 'd', state: preset }) })
    await waitFor(() => expect(result.current[0]).toEqual(preset))
  })

  it('does not re-apply the default over a later change', async () => {
    const saved = savedWith({ id: 'd', state: preset })
    const { result, rerender } = renderAt(saved)
    await waitFor(() => expect(result.current[0]).toEqual(preset))

    const searched = { sort: 'name', order: 'asc', filters: { search: 'dragon' } }
    act(() => result.current[1](searched))
    rerender({ s: saved })

    expect(result.current[0]).toEqual(searched)
  })

  it('restores the stored filters when the back button brings the user back', async () => {
    // The back-button bug: returning re-applied the default preset over whatever
    // the user had been looking at.
    const searched = { sort: 'name', order: 'asc', filters: { search: 'dragon' } }
    sessionStorage.setItem(KEY, JSON.stringify(searched))

    const { result } = renderAt(savedWith({ id: 'd', state: preset }), { returned: true })

    expect(result.current[0]).toEqual(searched)
    // Give the default-applying effect a chance to run and (correctly) do nothing.
    await waitFor(() => expect(result.current[0]).toEqual(searched))
  })

  it('re-applies the default on a fresh visit even after an earlier session change', async () => {
    // The regression this replaced: inferring "returning" from the presence of
    // stored state meant that once the user touched the filters, every later
    // arrival counted as a return and the default never came back.
    const searched = { sort: 'name', order: 'asc', filters: { search: 'dragon' } }
    sessionStorage.setItem(KEY, JSON.stringify(searched))

    const { result } = renderAt(savedWith({ id: 'd', state: preset }))

    await waitFor(() => expect(result.current[0]).toEqual(preset))
  })

  it('ignores stored filters entirely on a fresh visit with no default set', () => {
    const searched = { sort: 'name', order: 'asc', filters: { search: 'dragon' } }
    sessionStorage.setItem(KEY, JSON.stringify(searched))

    const { result } = renderAt(savedWith(null))

    // Arriving fresh starts clean, whether or not a default preset exists.
    expect(result.current[0]).toEqual(DEFAULT_SORT_FILTER)
  })

  it('keeps a cleared filter set on a return trip', async () => {
    // The user deliberately cleared their default away before drilling in;
    // coming back must not quietly restore it.
    sessionStorage.setItem(KEY, JSON.stringify(DEFAULT_SORT_FILTER))

    const { result } = renderAt(savedWith({ id: 'd', state: preset }), { returned: true })

    await waitFor(() => expect(result.current[0]).toEqual(DEFAULT_SORT_FILTER))
  })

  it('persists changes so a later return trip can read them back', async () => {
    const { result, unmount } = renderAt(savedWith(null))
    const searched = { sort: 'name', order: 'asc', filters: { search: 'goblin' } }
    act(() => result.current[1](searched))
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toContain('goblin'))
    unmount()

    const { result: back } = renderAt(savedWith(null), { returned: true })
    expect(back.current[0]).toEqual(searched)
  })
})

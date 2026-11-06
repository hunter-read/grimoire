import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import useUrlSortFilterState from './useUrlSortFilterState'

const INITIAL = { sort: 'name', order: 'asc', filters: {} }
const NO_PRESET = { loaded: true, defaultFilter: null }

const wrapper =
  (url: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  )

function useHarness(saved: { loaded: boolean; defaultFilter: unknown } = NO_PRESET) {
  const [state, setState] = useUrlSortFilterState('test:sortFilter', saved as never, INITIAL)
  return { state, setState, location: useLocation(), navigate: useNavigate() }
}

beforeEach(() => sessionStorage.clear())

describe('useUrlSortFilterState', () => {
  it('opens the view an address describes', () => {
    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapper('/maps?folder=Caves&sort=size&order=desc&q=orc'),
    })
    expect(result.current.state).toEqual({
      sort: 'size',
      order: 'desc',
      filters: { search: 'orc' },
    })
    expect(result.current.location.search).toBe('?folder=Caves&sort=size&order=desc&q=orc')
  })

  it('follows a described view ahead of the saved default', async () => {
    const preset = { loaded: true, defaultFilter: { state: { sort: 'added_at', filters: {} } } }
    const { result } = renderHook(() => useHarness(preset), { wrapper: wrapper('/maps?q=orc') })
    await waitFor(() => expect(result.current.state.filters).toEqual({ search: 'orc' }))
    expect(result.current.state.sort).toBe('name')
  })

  it('writes the view into the address, keeping the folder', async () => {
    const { result } = renderHook(() => useHarness(), { wrapper: wrapper('/maps?folder=Caves') })
    expect(result.current.location.search).toBe('?folder=Caves')
    act(() => result.current.setState({ sort: 'size', order: 'asc', filters: { favorites: true } }))
    await waitFor(() =>
      expect(result.current.location.search).toBe('?folder=Caves&sort=size&favorites=true')
    )
  })

  it('applies the address when Back or a link changes it', async () => {
    const { result } = renderHook(() => useHarness(), { wrapper: wrapper('/maps') })
    act(() => result.current.navigate('/maps?q=goblin'))
    await waitFor(() => expect(result.current.state.filters).toEqual({ search: 'goblin' }))
    act(() => result.current.navigate('/maps'))
    await waitFor(() => expect(result.current.state).toEqual(INITIAL))
  })
})

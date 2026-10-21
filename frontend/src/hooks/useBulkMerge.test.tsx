import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

let role = 'admin'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

vi.mock('../components/duplicates/MergeDialog', () => ({
  default: ({
    resourceType,
    ids,
    onDone,
  }: {
    resourceType: string
    ids: string[]
    onDone: (o: unknown) => void
  }) => (
    <button onClick={() => onDone({ action: 'merged', keepId: ids[0], removedIds: ids.slice(1) })}>
      {`dialog ${resourceType} ${ids.join(',')}`}
    </button>
  ),
}))

import useBulkMerge from './useBulkMerge'
import useMixedSelection from './useMixedSelection'

const books = (...ids: string[]) => ids.map((id) => ({ type: 'book', id }))

describe('useBulkMerge', () => {
  beforeEach(() => {
    role = 'admin'
  })

  it('offers nothing to non-admins', () => {
    role = 'gm'
    const { result } = renderHook(() => useBulkMerge(books('a', 'b'), vi.fn()))
    expect(result.current.barProps).toEqual({})
  })

  it.each([
    [books('a'), 'merge.selectTwoHint'],
    [[...books('a'), { type: 'map', id: 'm' }], 'merge.sameTypeHint'],
    [books(...Array.from({ length: 22 }, (_, i) => `b${i}`)), 'merge.tooManyHint'],
    [
      [
        { type: 'system', id: 's1' },
        { type: 'system', id: 's2' },
      ],
      'merge.notMergeableHint',
    ],
  ])('explains why a selection cannot merge', (selected, hint) => {
    const { result } = renderHook(() => useBulkMerge(selected, vi.fn()))
    expect(result.current.barProps).toMatchObject({ canMerge: false, mergeHint: hint })
  })

  it('opens the dialog for two copies of one item and reports the outcome', async () => {
    const onMerged = vi.fn()
    const Harness = () => {
      const merge = useBulkMerge(books('a', 'b'), onMerged)
      return (
        <>
          <button onClick={() => 'onMerge' in merge.barProps && merge.barProps.onMerge?.()}>
            open
          </button>
          {merge.dialog}
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('button', { name: 'dialog book a,b' }))
    expect(onMerged).toHaveBeenCalledWith(
      { action: 'merged', keepId: 'a', removedIds: ['b'] },
      'book'
    )
    expect(screen.queryByText(/dialog/)).not.toBeInTheDocument()
  })
})

describe('useMixedSelection', () => {
  it('tracks items by type and id', () => {
    const order = [...books('a', 'b'), { type: 'map', id: 'a' }]
    const { result } = renderHook(() => useMixedSelection(order))
    act(() => result.current.toggle('book', 'a'))
    act(() => result.current.toggle('map', 'a'))
    expect(result.current.isSelected('book', 'a')).toBe(true)
    expect(result.current.isSelected('book', 'b')).toBe(false)
    expect(result.current.selected).toEqual([
      { type: 'book', id: 'a' },
      { type: 'map', id: 'a' },
    ])
  })

  it('selects a range in display order with shift', () => {
    const order = books('a', 'b', 'c')
    const { result } = renderHook(() => useMixedSelection(order))
    act(() => result.current.toggle('book', 'a'))
    act(() => result.current.toggle('book', 'c', { shift: true }))
    expect(result.current.selected.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('forgets merged items', () => {
    const { result } = renderHook(() => useMixedSelection())
    act(() => result.current.toggle('book', 'a'))
    act(() => result.current.toggle('book', 'b'))
    act(() => result.current.forget(['a']))
    expect(result.current.selected).toEqual([{ type: 'book', id: 'b' }])
  })
})

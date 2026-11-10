import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import useGmScreen from './useGmScreen'
import type { Panel } from './types'

vi.mock('../../api', () => ({
  gmScreen: {
    get: vi.fn(),
    party: vi.fn(),
    updatePanel: vi.fn(),
    saveLayout: vi.fn(),
    addPanel: vi.fn(),
    removePanel: vi.fn(),
    reset: vi.fn(),
  },
  characters: { update: vi.fn() },
}))

import { characters, gmScreen } from '../../api'
const api = gmScreen as unknown as Record<keyof typeof gmScreen, Mock>
const charactersApi = characters as unknown as { update: Mock }

const panel = (id: string, extra: Partial<Panel> = {}): Panel => ({
  id,
  kind: 'counter',
  title: '',
  x: 0,
  y: 0,
  w: 3,
  h: 3,
  config: {},
  state: { value: 0 },
  ...extra,
})

const party = {
  characters: [
    {
      id: 'c1',
      name: 'Rook',
      user_id: 'u1',
      owner_name: 'Ana',
      status: 'active',
      editable: true,
      schema_ref: 's',
      schema_name: 'S',
      values: { hp: 1 },
    },
  ],
  fields: [],
}

async function loaded() {
  const hook = renderHook(() => useGmScreen('camp'))
  await waitFor(() => expect(hook.result.current.panels).not.toBeNull())
  return hook
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ panels: [panel('a'), panel('b', { x: 3 })] })
  api.party.mockResolvedValue(party)
})

describe('useGmScreen', () => {
  it('loads the board and the party', async () => {
    const { result } = await loaded()
    expect(result.current.panels!.map((p) => p.id)).toEqual(['a', 'b'])
    await waitFor(() => expect(result.current.party.characters).toHaveLength(1))
    expect(api.get).toHaveBeenCalledWith('camp')
  })

  it('shows a change at once and keeps only the latest answer', async () => {
    const { result } = await loaded()
    let first!: (value: Panel) => void
    api.updatePanel
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce(panel('a', { state: { value: 2 } }))
    act(() => {
      void result.current.savePanel('a', { state: { value: 1 } })
    })
    expect(result.current.panels![0].state).toEqual({ value: 1 })
    await act(() => result.current.savePanel('a', { state: { value: 2 } }))
    // The first save answers late; its stale value is not applied.
    await act(async () => first(panel('a', { state: { value: 1 } })))
    expect(result.current.panels![0].state).toEqual({ value: 2 })
  })

  it('sends only the cells a move changed', async () => {
    const { result } = await loaded()
    await act(() =>
      result.current.moveCells([
        { id: 'a', x: 0, y: 3, w: 3, h: 3 },
        { id: 'b', x: 3, y: 0, w: 3, h: 3 },
      ])
    )
    expect(api.saveLayout).toHaveBeenCalledWith('camp', [{ id: 'a', x: 0, y: 3, w: 3, h: 3 }])
    expect(result.current.panels![0].y).toBe(3)
    api.saveLayout.mockClear()
    await act(() => result.current.moveCells([{ id: 'a', x: 0, y: 3, w: 3, h: 3 }]))
    expect(api.saveLayout).not.toHaveBeenCalled()
  })

  it('adds, removes and resets panels', async () => {
    const { result } = await loaded()
    api.addPanel.mockResolvedValue(panel('c', { kind: 'scratch' }))
    await act(() => result.current.addPanel('scratch', 'Scratch note'))
    expect(api.addPanel).toHaveBeenCalledWith('camp', { kind: 'scratch', title: 'Scratch note' })
    expect(result.current.panels!.map((p) => p.id)).toEqual(['a', 'b', 'c'])

    api.removePanel.mockResolvedValue({ panels: [panel('a')] })
    await act(() => result.current.removePanel('b'))
    expect(result.current.panels!.map((p) => p.id)).toEqual(['a'])

    api.reset.mockResolvedValue({ panels: [panel('a', { state: { value: 9 } })] })
    await act(() => result.current.reset('scene'))
    expect(api.reset).toHaveBeenCalledWith('camp', 'scene')
    expect(result.current.panels![0].state).toEqual({ value: 9 })
  })

  it('changes a party value and reloads what follows from it', async () => {
    const { result } = await loaded()
    charactersApi.update.mockResolvedValue({})
    await act(() => result.current.setCharacterValue('c1', 'hp', 3))
    expect(charactersApi.update).toHaveBeenCalledWith('c1', { data: { hp: 3 } })
    expect(api.party).toHaveBeenCalledTimes(2)
  })

  it('reports a failure and can clear it', async () => {
    const { result } = await loaded()
    api.updatePanel.mockRejectedValue(new Error('Campaign is archived'))
    await act(() => result.current.savePanel('a', { title: 'x' }))
    expect(result.current.error).toBe('Campaign is archived')
    act(() => result.current.clearError())
    expect(result.current.error).toBe('')

    api.addPanel.mockRejectedValue(new Error('full'))
    expect(await act(() => result.current.addPanel('note', 'Note'))).toBeNull()
    api.saveLayout.mockRejectedValue(new Error('layout'))
    await act(() => result.current.moveCells([{ id: 'a', x: 5, y: 0, w: 3, h: 3 }]))
    api.removePanel.mockRejectedValue(new Error('remove'))
    await act(() => result.current.removePanel('a'))
    api.reset.mockRejectedValue(new Error('reset'))
    await act(() => result.current.reset('rest'))
    expect(result.current.error).toBe('reset')
    charactersApi.update.mockRejectedValue(new Error('not yours'))
    await act(() => result.current.setCharacterValue('c1', 'hp', 1))
    expect(result.current.error).toBe('not yours')
  })

  it('reports a board that will not load', async () => {
    api.get.mockRejectedValue(new Error('Only the campaign GM'))
    const { result } = renderHook(() => useGmScreen('camp'))
    await waitFor(() => expect(result.current.error).toBe('Only the campaign GM'))
  })
})

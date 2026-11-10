import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { characters, gmScreen } from '../../api'
import { changedCells, type Cell } from './gridLayout'
import type { Panel, PanelKind, PartyOverview, ResetScope } from './types'

export interface PanelPatch {
  title?: string
  config?: Record<string, unknown>
  state?: Record<string, unknown>
}

const cellOf = (panel: Panel): Cell => ({
  id: panel.id,
  x: panel.x,
  y: panel.y,
  w: panel.w,
  h: panel.h,
})

/**
 * A campaign's GM screen: its panels and party, and every way of changing them.
 *
 * Changes show at once and are saved behind the scenes. Each panel keeps a
 * count of its saves in flight and only the latest answer is applied, so
 * ticking three boxes quickly never flickers back to the first tick while the
 * server catches up.
 */
export default function useGmScreen(campaignId: string) {
  const { t } = useTranslation()
  const [panels, setPanels] = useState<Panel[] | null>(null)
  const [party, setParty] = useState<PartyOverview>({ characters: [], fields: [] })
  const [error, setError] = useState('')
  const saves = useRef(new Map<string, number>())
  const panelsRef = useRef<Panel[]>([])
  panelsRef.current = panels ?? []

  const fail = useCallback(
    (e: unknown) => setError((e as Error)?.message || t('common.error')),
    [t]
  )

  const loadParty = useCallback(
    () => gmScreen.party(campaignId).then(setParty).catch(fail),
    [campaignId, fail]
  )

  useEffect(() => {
    let cancelled = false
    gmScreen
      .get(campaignId)
      .then((board) => {
        if (!cancelled) setPanels(board.panels)
      })
      .catch((e) => {
        if (!cancelled) fail(e)
      })
    void loadParty()
    return () => {
      cancelled = true
    }
  }, [campaignId, fail, loadParty])

  const replace = useCallback((board: { panels: Panel[] }) => setPanels(board.panels), [])

  const savePanel = useCallback(
    async (id: string, patch: PanelPatch) => {
      setPanels((current) =>
        (current ?? []).map((panel) => (panel.id === id ? { ...panel, ...patch } : panel))
      )
      const ticket = (saves.current.get(id) ?? 0) + 1
      saves.current.set(id, ticket)
      try {
        const saved = await gmScreen.updatePanel(campaignId, id, patch)
        if (saves.current.get(id) !== ticket) return
        setPanels((current) => (current ?? []).map((panel) => (panel.id === id ? saved : panel)))
      } catch (e) {
        fail(e)
      }
    },
    [campaignId, fail]
  )

  const moveCells = useCallback(
    async (next: Cell[]) => {
      const before = panelsRef.current.map(cellOf)
      const moved = changedCells(before, next)
      if (!moved.length) return
      const byId = new Map(next.map((cell) => [cell.id, cell]))
      setPanels((current) =>
        (current ?? []).map((panel) => {
          const cell = byId.get(panel.id)
          return cell ? { ...panel, x: cell.x, y: cell.y, w: cell.w, h: cell.h } : panel
        })
      )
      try {
        await gmScreen.saveLayout(campaignId, moved)
      } catch (e) {
        fail(e)
      }
    },
    [campaignId, fail]
  )

  const addPanel = useCallback(
    async (kind: PanelKind, title: string) => {
      try {
        const panel = await gmScreen.addPanel(campaignId, { kind, title })
        setPanels((current) => [...(current ?? []), panel])
        return panel
      } catch (e) {
        fail(e)
        return null
      }
    },
    [campaignId, fail]
  )

  const removePanel = useCallback(
    async (id: string) => {
      try {
        replace(await gmScreen.removePanel(campaignId, id))
      } catch (e) {
        fail(e)
      }
    },
    [campaignId, fail, replace]
  )

  const reset = useCallback(
    async (scope: Exclude<ResetScope, ''>) => {
      try {
        replace(await gmScreen.reset(campaignId, scope))
      } catch (e) {
        fail(e)
      }
    },
    [campaignId, fail, replace]
  )

  /** Change one value on a party member's sheet, where the GM may. */
  const setCharacterValue = useCallback(
    async (characterId: string, field: string, value: number | null) => {
      setParty((current) => ({
        ...current,
        characters: current.characters.map((character) =>
          character.id === characterId
            ? { ...character, values: { ...character.values, [field]: value } }
            : character
        ),
      }))
      try {
        await characters.update(characterId, { data: { [field]: value } })
        // Computed values follow the change - a threshold built on the level.
        await loadParty()
      } catch (e) {
        fail(e)
        void loadParty()
      }
    },
    [fail, loadParty]
  )

  return {
    panels,
    party,
    error,
    clearError: () => setError(''),
    replace,
    savePanel,
    moveCells,
    addPanel,
    removePanel,
    reset,
    loadParty,
    setCharacterValue,
  }
}

export type GmScreen = ReturnType<typeof useGmScreen>

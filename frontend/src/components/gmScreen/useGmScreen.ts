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
 *
 * A save that fails is undone: once a panel's (or the layout's) saves in
 * flight have all answered, anything that did not stick goes back to what the
 * server holds, so the board never shows a change that was not saved.
 *
 * Every action records its failure in `error` and resolves to whether it
 * worked - it never rejects - so a caller can fire it from an event handler
 * and still tell success apart from failure (`reset` -> "done" only on success).
 */
export default function useGmScreen(campaignId: string) {
  const { t } = useTranslation()
  const [panels, setPanels] = useState<Panel[] | null>(null)
  const [party, setParty] = useState<PartyOverview>({ characters: [], fields: [] })
  const [error, setError] = useState('')
  const saves = useRef(new Map<string, number>())
  // One burst of saves per panel: the panel as the server last confirmed it,
  // which fields the burst touched, and whether any of its saves failed.
  const edits = useRef(
    new Map<string, { pending: number; failed: boolean; base?: Panel; keys: Set<string> }>()
  )
  // The same for the layout, which is saved as a whole board of cells.
  const layout = useRef<{ pending: number; failed: boolean; base: Map<string, Cell> } | null>(null)
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
    async (id: string, patch: PanelPatch): Promise<boolean> => {
      let burst = edits.current.get(id)
      if (!burst) {
        // Nothing in flight, so what is on screen is what the server holds.
        const base = panelsRef.current.find((panel) => panel.id === id)
        burst = { pending: 0, failed: false, base, keys: new Set() }
        edits.current.set(id, burst)
      }
      burst.pending += 1
      for (const key of Object.keys(patch)) burst.keys.add(key)
      setPanels((current) =>
        (current ?? []).map((panel) => (panel.id === id ? { ...panel, ...patch } : panel))
      )
      const ticket = (saves.current.get(id) ?? 0) + 1
      saves.current.set(id, ticket)
      let ok = true
      try {
        const saved = await gmScreen.updatePanel(campaignId, id, patch)
        burst.base = saved
        if (saves.current.get(id) === ticket) {
          setPanels((current) => (current ?? []).map((panel) => (panel.id === id ? saved : panel)))
        }
      } catch (e) {
        ok = false
        burst.failed = true
        fail(e)
      } finally {
        burst.pending -= 1
        if (burst.pending === 0) {
          edits.current.delete(id)
          const { base, failed, keys } = burst
          // Put back only the fields this burst changed, so a move made in
          // the meantime is not undone with it.
          if (failed && base) {
            const restore = Object.fromEntries(
              [...keys].map((key) => [key, base[key as keyof Panel]])
            )
            setPanels((current) =>
              (current ?? []).map((panel) => (panel.id === id ? { ...panel, ...restore } : panel))
            )
          }
        }
      }
      return ok
    },
    [campaignId, fail]
  )

  const moveCells = useCallback(
    async (next: Cell[]): Promise<boolean> => {
      const before = panelsRef.current.map(cellOf)
      const moved = changedCells(before, next)
      if (!moved.length) return true
      if (!layout.current) {
        layout.current = {
          pending: 0,
          failed: false,
          base: new Map(before.map((cell) => [cell.id, cell])),
        }
      }
      const burst = layout.current
      burst.pending += 1
      const byId = new Map(next.map((cell) => [cell.id, cell]))
      setPanels((current) =>
        (current ?? []).map((panel) => {
          const cell = byId.get(panel.id)
          return cell ? { ...panel, x: cell.x, y: cell.y, w: cell.w, h: cell.h } : panel
        })
      )
      let ok = true
      try {
        await gmScreen.saveLayout(campaignId, moved)
        for (const cell of moved) burst.base.set(cell.id, cell)
      } catch (e) {
        ok = false
        burst.failed = true
        fail(e)
      } finally {
        burst.pending -= 1
        if (burst.pending === 0) {
          layout.current = null
          if (burst.failed) {
            setPanels((current) =>
              (current ?? []).map((panel) => {
                const cell = burst.base.get(panel.id)
                return cell ? { ...panel, x: cell.x, y: cell.y, w: cell.w, h: cell.h } : panel
              })
            )
          }
        }
      }
      return ok
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
    async (id: string): Promise<boolean> => {
      try {
        replace(await gmScreen.removePanel(campaignId, id))
        return true
      } catch (e) {
        fail(e)
        return false
      }
    },
    [campaignId, fail, replace]
  )

  const reset = useCallback(
    async (scope: Exclude<ResetScope, ''>): Promise<boolean> => {
      try {
        replace(await gmScreen.reset(campaignId, scope))
        return true
      } catch (e) {
        fail(e)
        return false
      }
    },
    [campaignId, fail, replace]
  )

  /** Change one value on a party member's sheet, where the GM may. */
  const setCharacterValue = useCallback(
    async (characterId: string, field: string, value: number | null): Promise<boolean> => {
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
        return true
      } catch (e) {
        fail(e)
        void loadParty()
        return false
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

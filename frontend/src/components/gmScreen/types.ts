/**
 * What each kind of GM screen panel holds. The server cleans every value
 * (`backend/services/gm_screen/panels.py`), so these mirror its shapes; the
 * readers below still tolerate a missing key, since a panel saved before a key
 * existed comes back without it.
 */
import type { Schema } from '../../api'

export type Panel = Schema<'GmPanelOut'>
export type PanelKind =
  | 'note'
  | 'party'
  | 'counter'
  | 'clocks'
  | 'pools'
  | 'scratch'
  | 'initiative'
  | 'reference'
  | 'table'
export type ResetScope = '' | 'scene' | 'session' | 'rest'
export type PartyOverview = Schema<'GmPartyOut'>
export type PartyCharacter = Schema<'GmPartyCharacter'>

export const PANEL_KINDS: PanelKind[] = [
  'party',
  'note',
  'counter',
  'clocks',
  'pools',
  'initiative',
  'reference',
  'table',
  'scratch',
]
export const RESET_SCOPES: ResetScope[] = ['', 'scene', 'session', 'rest']

export interface NoteConfig {
  page_id: string | null
  page_slug: string
}

export interface PartyStat {
  label: string
  value: string
  max: string | number | null
  style: 'number' | 'pips'
}
export interface PartyConfig {
  stats: PartyStat[]
  include_inactive: boolean
}

export interface CounterConfig {
  min: number
  max: number | null
  start: number
  style: 'number' | 'pips'
  resets: ResetScope
}
export interface CounterState {
  value: number
}

export interface Clock {
  id: string
  name: string
  size: number
  ticks: number
  note: string
  resets: ResetScope
  loops: boolean
}
export interface ClocksConfig {
  mode: 'countdown' | 'clock'
}

export interface Pool {
  id: string
  name: string
  tokens: number
  note: string
}
export interface PoolsConfig {
  resets: ResetScope
}

export interface Side {
  key: string
  label: string
}
export interface Combatant {
  id: string
  name: string
  score: number | null
  side: string
  acted: boolean
  note: string
  character_id: string | null
}
export interface InitiativeConfig {
  mode: 'ordered' | 'sides'
  sides: Side[]
  resets: ResetScope
}
export interface InitiativeState {
  round: number
  turn: number
  side: string
  first: string
  entries: Combatant[]
}

export interface ReferenceSection {
  id: string
  title: string
  text: string
}
export interface ReferenceConfig {
  sections: ReferenceSection[]
}

export interface TableColumn {
  id: string
  label: string
  entries: string[]
}
export interface TableConfig {
  /** `list`: each column's result on its own line; `join`: run together, for names. */
  mode: 'list' | 'join'
  columns: TableColumn[]
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function counterConfig(config: Record<string, unknown>): CounterConfig {
  return {
    min: num(config.min, 0),
    max: typeof config.max === 'number' ? config.max : null,
    start: num(config.start, num(config.min, 0)),
    style: config.style === 'pips' ? 'pips' : 'number',
    resets: (config.resets as ResetScope) || '',
  }
}

export function partyConfig(config: Record<string, unknown>): PartyConfig {
  return {
    stats: Array.isArray(config.stats) ? (config.stats as PartyStat[]) : [],
    include_inactive: config.include_inactive === true,
  }
}

export function initiativeConfig(config: Record<string, unknown>): InitiativeConfig {
  const sides =
    Array.isArray(config.sides) && config.sides.length >= 2
      ? (config.sides as Side[])
      : DEFAULT_SIDES
  return {
    mode: config.mode === 'sides' ? 'sides' : 'ordered',
    sides,
    resets: (config.resets as ResetScope) || '',
  }
}

export function initiativeState(
  state: Record<string, unknown>,
  config: InitiativeConfig
): InitiativeState {
  return {
    round: num(state.round, 1),
    turn: num(state.turn, 0),
    side: typeof state.side === 'string' ? state.side : config.sides[0].key,
    first: typeof state.first === 'string' ? state.first : config.sides[0].key,
    entries: Array.isArray(state.entries) ? (state.entries as Combatant[]) : [],
  }
}

export function referenceConfig(config: Record<string, unknown>): ReferenceConfig {
  return {
    sections: Array.isArray(config.sections) ? (config.sections as ReferenceSection[]) : [],
  }
}

export function tableConfig(config: Record<string, unknown>): TableConfig {
  return {
    mode: config.mode === 'join' ? 'join' : 'list',
    columns: Array.isArray(config.columns)
      ? (config.columns as TableColumn[]).filter((column) => Array.isArray(column.entries))
      : [],
  }
}

/** The last roll, one 1-based entry number per column, or [] when it no longer fits. */
export function tableRolls(state: Record<string, unknown>, config: TableConfig): number[] {
  const rolls = Array.isArray(state.rolls) ? (state.rolls as unknown[]) : []
  const fits =
    rolls.length === config.columns.length &&
    rolls.every(
      (roll, index) =>
        typeof roll === 'number' && roll >= 1 && roll <= config.columns[index].entries.length
    )
  return fits ? (rolls as number[]) : []
}

export const DEFAULT_SIDES: Side[] = [
  { key: 'heroes', label: 'Heroes' },
  { key: 'foes', label: 'Foes' },
]

export const items = <T>(state: Record<string, unknown>): T[] =>
  Array.isArray(state.items) ? (state.items as T[]) : []

/** A short id for a new row, the way the server would give one. */
export const rowId = () => Math.random().toString(36).slice(2, 14)

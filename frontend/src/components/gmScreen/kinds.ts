import type { ComponentType } from 'react'
import type { SettingsProps } from './GmPanelFrame'
import ClocksPanel from './panels/ClocksPanel'
import CounterPanel from './panels/CounterPanel'
import InitiativePanel from './panels/InitiativePanel'
import NotePanel from './panels/NotePanel'
import PartyPanel from './panels/PartyPanel'
import PoolsPanel from './panels/PoolsPanel'
import ScratchPanel from './panels/ScratchPanel'
import type { PanelBodyProps } from './panels/panelProps'
import ClocksSettings from './settings/ClocksSettings'
import CounterSettings from './settings/CounterSettings'
import InitiativeSettings from './settings/InitiativeSettings'
import NoteSettings from './settings/NoteSettings'
import PartySettings from './settings/PartySettings'
import PoolsSettings from './settings/PoolsSettings'
import type { PanelKind } from './types'

/** Each tool's body, and the form its settings open, by kind. */
export const KIND_VIEWS: Record<
  PanelKind,
  { Body: ComponentType<PanelBodyProps>; Settings?: ComponentType<SettingsProps> }
> = {
  note: { Body: NotePanel, Settings: NoteSettings },
  party: { Body: PartyPanel, Settings: PartySettings },
  counter: { Body: CounterPanel, Settings: CounterSettings },
  clocks: { Body: ClocksPanel, Settings: ClocksSettings },
  pools: { Body: PoolsPanel, Settings: PoolsSettings },
  scratch: { Body: ScratchPanel },
  initiative: { Body: InitiativePanel, Settings: InitiativeSettings },
}

/**
 * The board a new GM screen can start from: the party across the top, then
 * the turn order, countdowns and a scratch note beneath it.
 */
export const STARTER_BOARD = (titles: (kind: PanelKind) => string) => ({
  panels: [
    { kind: 'party', title: titles('party'), x: 0, y: 0, w: 12, h: 4 },
    { kind: 'initiative', title: titles('initiative'), x: 0, y: 4, w: 4, h: 8 },
    { kind: 'clocks', title: titles('clocks'), x: 4, y: 4, w: 4, h: 8 },
    { kind: 'scratch', title: titles('scratch'), x: 8, y: 4, w: 4, h: 8 },
  ],
})

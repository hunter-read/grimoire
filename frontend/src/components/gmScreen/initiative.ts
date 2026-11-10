/**
 * The initiative tracker's rules, apart from how it is drawn.
 *
 * Two ways a table takes turns:
 *
 * - **ordered** - one combatant after another, highest score first. Next turn
 *   walks the list; past the end, a new round starts at the top.
 * - **sides** - the sides take turns, and each combatant is marked once it has
 *   gone this round. Marking the last one of a side's turn hands it to the next
 *   side with anyone left to act; the next round clears every mark and gives
 *   the first turn back to the side that goes first.
 */
import { rowId, type Combatant, type InitiativeState, type Side } from './types'

export function nextTurn(state: InitiativeState): InitiativeState {
  if (!state.entries.length) return state
  const turn = state.turn + 1
  return turn >= state.entries.length
    ? { ...state, turn: 0, round: state.round + 1 }
    : { ...state, turn }
}

export function previousTurn(state: InitiativeState): InitiativeState {
  if (!state.entries.length) return state
  if (state.turn > 0) return { ...state, turn: state.turn - 1 }
  if (state.round <= 1) return state
  return { ...state, turn: state.entries.length - 1, round: state.round - 1 }
}

/** Highest score first; a combatant without one goes last, in the order added. */
export function sortByScore(state: InitiativeState): InitiativeState {
  const entries = state.entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const left = a.entry.score ?? -Infinity
      const right = b.entry.score ?? -Infinity
      return right - left || a.index - b.index
    })
    .map(({ entry }) => entry)
  return { ...state, entries, turn: 0 }
}

/** The next side after `from`, in order, that still has someone to act. */
function nextSideToAct(entries: Combatant[], sides: Side[], from: string): string {
  const start = sides.findIndex((side) => side.key === from)
  for (let step = 1; step <= sides.length; step += 1) {
    const side = sides[(start + step) % sides.length]
    if (entries.some((entry) => entry.side === side.key && !entry.acted)) return side.key
  }
  return from
}

export function markActed(
  state: InitiativeState,
  sides: Side[],
  id: string,
  acted: boolean
): InitiativeState {
  const entries = state.entries.map((entry) => (entry.id === id ? { ...entry, acted } : entry))
  const marked = state.entries.find((entry) => entry.id === id)
  // One of the acting side has gone: the turn passes on.
  const side =
    acted && marked && marked.side === state.side
      ? nextSideToAct(entries, sides, state.side)
      : state.side
  return { ...state, entries, side }
}

export function nextRound(state: InitiativeState): InitiativeState {
  return {
    ...state,
    round: state.round + 1,
    turn: 0,
    side: state.first,
    entries: state.entries.map((entry) => ({ ...entry, acted: false })),
  }
}

/** Who goes first each round, which also makes it their turn now. */
export function goesFirst(state: InitiativeState, side: string): InitiativeState {
  return { ...state, first: side, side }
}

export function addCombatant(
  state: InitiativeState,
  combatant: Partial<Combatant> & { name: string; side: string }
): InitiativeState {
  const entry: Combatant = {
    id: rowId(),
    score: null,
    acted: false,
    note: '',
    character_id: null,
    ...combatant,
  }
  return { ...state, entries: [...state.entries, entry] }
}

export function removeCombatant(state: InitiativeState, id: string): InitiativeState {
  const index = state.entries.findIndex((entry) => entry.id === id)
  if (index < 0) return state
  const entries = state.entries.filter((entry) => entry.id !== id)
  // Whoever's turn it was keeps it; removing someone earlier shifts it back.
  const turn =
    index < state.turn ? state.turn - 1 : Math.min(state.turn, Math.max(0, entries.length - 1))
  return { ...state, entries, turn }
}

export function updateCombatant(
  state: InitiativeState,
  id: string,
  patch: Partial<Combatant>
): InitiativeState {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  }
}

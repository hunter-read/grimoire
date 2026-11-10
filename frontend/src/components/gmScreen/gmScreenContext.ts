import { createContext, useContext } from 'react'
import type { PartyOverview } from './types'

/** What the panels share: the campaign, its party, and changing a party value. */
export interface GmScreenContextValue {
  campaignId: string
  party: PartyOverview
  setCharacterValue: (characterId: string, field: string, value: number | null) => void
}

export const GmScreenContext = createContext<GmScreenContextValue>({
  campaignId: '',
  party: { characters: [], fields: [] },
  setCharacterValue: () => {},
})

export const useGmScreenContext = () => useContext(GmScreenContext)

import { createContext, useContext } from 'react'
import type { Schema } from '../../api'
import type { PortraitCrop } from './portraitCrop'

/** The parts of a character its pictures need. */
export interface PortraitCharacter {
  id: string
  name?: string | null
  portrait_path?: string | null
  portrait_version?: number | null
  portrait_crop?: PortraitCrop | null
}

export type PortraitPatch = Partial<
  Pick<Schema<'CharacterDetail'>, 'portrait_path' | 'portrait_version' | 'portrait_crop'>
>

/**
 * What a sheet's pictures need from the character they belong to.
 *
 * The field renderer is deliberately ignorant of the character it draws for -
 * the same renderer draws catalog entries and ruleset forms - but an image
 * field and `<g-portrait>` have to upload against one. The detail view
 * provides this rather than threading a character through every layout node;
 * anywhere it is absent, the pictures draw as unavailable.
 */
export interface CharacterMedia {
  character: PortraitCharacter
  readOnly: boolean
  onPortraitChanged: (patch: PortraitPatch) => void
  /** A field's picture changed on the server; `null` when it was removed. */
  onImageChanged: (field: string, value: string | null) => void
  onError: (message: string) => void
  /** Opens the large view of the portrait, where the owner frames it. */
  openPortrait: () => void
}

export const CharacterMediaContext = createContext<CharacterMedia | null>(null)

export const useCharacterMedia = () => useContext(CharacterMediaContext)

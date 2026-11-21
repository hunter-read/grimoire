import { mediaUrl } from '../../../api'
import type { TokenRecipe, TokenRecipeUpload } from '../../../api'
import type { TokenTransform } from '../../../lib/tokenCompositor'

/**
 * Where the editor's art came from, kept so a stored token can be reopened.
 *
 * A library token or map is referenced by id - the server copies nothing out of
 * a library that may be read-only. Art from the device exists nowhere else, so
 * its bytes travel with the token and the server keeps them.
 */
export type SourceRef = { type: 'token' | 'map'; id: string } | { type: 'upload'; blob: Blob }

/** The editor state a recipe records, beside its source. */
export interface RecipeSettings {
  size: number
  frameId: string | null
  frameColor: string
  background: string
  transform: TokenTransform
}

/**
 * The recipe to send with a token, or null when the art came from somewhere
 * the editor cannot point back to (then the token is stored without one).
 */
export function buildRecipe(
  ref: SourceRef | null,
  settings: RecipeSettings
): TokenRecipeUpload | null {
  if (!ref) return null
  const recipe: TokenRecipe = {
    size: settings.size,
    frame_id: settings.frameId,
    frame_color: settings.frameColor,
    background: settings.background,
    transform: { ...settings.transform },
    source: ref.type === 'upload' ? { type: 'upload', id: null } : { type: ref.type, id: ref.id },
  }
  return { recipe, source: ref.type === 'upload' ? ref.blob : null }
}

/** A library source's full-resolution file, or null for any other source. */
export function librarySource(
  source: TokenRecipe['source']
): { ref: SourceRef; url: string } | null {
  if ((source.type !== 'token' && source.type !== 'map') || !source.id) return null
  return {
    ref: { type: source.type, id: source.id },
    url: mediaUrl(`/${source.type}s/${source.id}/file`),
  }
}

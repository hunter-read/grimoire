import { campaigns, mediaUrl, type Schema } from '../../../api'

/** A pin as the page detail serves it - only the ones this viewer may see. */
export type WikiPin = Schema<'WikiMapPinOut'>
/** What a map page shows: a library map, a campaign image, or nothing yet. */
export type WikiMap = Schema<'WikiMapOut'>

// The maps a map page can show (issue #578): still images, drawn as they are.
// Mirrors `_IMAGE_MAP_EXTS` in backend/routers/campaigns/_wiki_maps.py.
const IMAGE_MAP_RE = /\.(png|jpe?g|gif|webp|bmp)$/i

export const isImageMapName = (name: string | null | undefined) => IMAGE_MAP_RE.test(name || '')

/** The picture's URL, or null when there is nothing to draw. */
export function mapImageUrl(campaignId: string, map: WikiMap | null | undefined): string | null {
  if (!map?.id) return null
  if (map.source === 'library') return mediaUrl(`/maps/${map.id}/page/1`, { width: 3000 })
  if (map.source === 'file') return campaigns.fileUrl(campaignId, map.id)
  return null
}

/** The text a pin goes by: its own label, else the page it opens. */
export const pinName = (pin: Pick<WikiPin, 'label' | 'target_title'>) =>
  pin.label || pin.target_title || ''

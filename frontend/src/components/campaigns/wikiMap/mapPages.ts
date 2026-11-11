import { campaigns, imageSources, mediaUrl, type Schema } from '../../../api'

/** A pin as the page detail serves it - only the ones this viewer may see. */
export type WikiPin = Schema<'WikiMapPinOut'>
/** What a map page shows: a library map, a campaign image, or nothing yet. */
export type WikiMap = Schema<'WikiMapOut'>
/** What a map page can show: a library map or one of the campaign's images. */
export type MapChoice = { map_id: string } | { map_file_id: string }

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

/** A choice made in the map picker, as the page will serve it once saved. */
export function choiceToMap(choice: MapChoice, name: string): WikiMap {
  return 'map_id' in choice
    ? { source: 'library', id: choice.map_id, name }
    : { source: 'file', id: choice.map_file_id, name }
}

/**
 * A small picture of a map for a picker tile: a library map's own thumbnail,
 * or a small render of it while none has been made; a campaign image as it is.
 */
export function mapThumbUrl(
  campaignId: string,
  source: 'library' | 'file',
  id: string,
  hasThumbnail?: boolean | null
): string {
  if (source === 'file') return campaigns.fileUrl(campaignId, id)
  return (
    (hasThumbnail && imageSources.thumbUrl('map', id)) ||
    mediaUrl(`/maps/${id}/page/1`, { width: 480 })
  )
}

/** The text a pin goes by: its own label, else the page it opens. */
export const pinName = (pin: Pick<WikiPin, 'label' | 'target_title'>) =>
  pin.label || pin.target_title || ''

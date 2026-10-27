/**
 * Shapes shared across the Universal VTT editor.
 *
 * The document mirrors what the API stores (`VttDocumentIn`), but with every
 * array and the environment always present: `normalizeDoc` fills them in, so the
 * editor never has to null-check a feature list.
 */

/** A point in whichever space the caller is working in (image, grid or screen). */
export interface Point {
  x: number
  y: number
}

export interface VttLight {
  position: Point
  range: number
  intensity: number
  color: string
  shadows: boolean
}

export interface VttPortal {
  bounds: Point[]
  closed?: boolean
  freestanding?: boolean
}

export interface VttEnvironment {
  baked_lighting: boolean
  ambient_light: string
}

export interface VttDoc {
  line_of_sight: Point[][]
  objects_line_of_sight: Point[][]
  portals: VttPortal[]
  lights: VttLight[]
  environment: VttEnvironment
}

/** The polyline layers: walls and object walls. */
export type LineKey = 'line_of_sight' | 'objects_line_of_sight'

/** A document array the editor can select from. */
export type FeatureKey = LineKey | 'portals' | 'lights'

/** A selected feature: which array, and where in it. */
export interface Selection {
  key: FeatureKey
  index: number
}

/** Feature counts per layer, as the sidebar shows them. */
export type FeatureCounts = Record<FeatureKey, number>

/** How a drawn point snaps. */
export type SnapMode = 'grid' | 'half' | 'free'

/** The shape being drawn, plus the cursor it rubber-bands to. */
export interface Draft {
  points: Point[]
  cursor: Point | null
  free?: boolean
}

/** The player-view preview's token settings, in grid squares. */
export interface PreviewSettings {
  vision: boolean
  nightVision: boolean
  nightVisionRange: number
  lightRange: number
}

/** The preview as the editor holds it: settings plus the token's position. */
export interface PreviewState extends PreviewSettings {
  enabled: boolean
  token: Point | null
}

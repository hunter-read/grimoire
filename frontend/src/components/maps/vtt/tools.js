/**
 * Tool definitions for the Universal VTT editor.
 *
 * Each tool names the document key it writes to, so the canvas and the layer
 * panel can be driven from one table rather than a switch in each of them.
 *
 * `objects` is deliberately its own tool rather than a flag on walls: importers
 * treat `objects_line_of_sight` differently (Roll20 turns it into transparent
 * barriers rather than solid walls), so furniture and pillars are a genuinely
 * different thing to draw, not a style of wall.
 */

export const TOOL_SELECT = 'select'
export const TOOL_WALL = 'wall'
export const TOOL_OBJECT = 'object'
export const TOOL_PORTAL = 'portal'
export const TOOL_LIGHT = 'light'

/** Which document array each drawing tool appends to. */
export const TOOL_TARGET = {
  [TOOL_WALL]: 'line_of_sight',
  [TOOL_OBJECT]: 'objects_line_of_sight',
  [TOOL_PORTAL]: 'portals',
  [TOOL_LIGHT]: 'lights',
}

/** Tools that build a multi-point polyline (click to add, double-click to end). */
export const POLYLINE_TOOLS = new Set([TOOL_WALL, TOOL_OBJECT])

/** How each feature layer is drawn. Colours are deliberately distinguishable
 *  without relying on hue alone — portals are dashed, lights are circles. */
export const LAYER_STYLE = {
  line_of_sight: { stroke: '#e8503a', width: 3 },
  objects_line_of_sight: { stroke: '#3aa0e8', width: 3 },
  portals: { stroke: '#f0c040', width: 5 },
  lights: { stroke: '#ffd98a', width: 2 },
}

/** Default light, in the units the format uses: range in grid squares. */
export const DEFAULT_LIGHT = {
  range: 4,
  intensity: 1,
  color: 'ffffffff',
  shadows: true,
}

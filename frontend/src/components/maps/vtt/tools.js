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
export const TOOL_WINDOW = 'window'
export const TOOL_LIGHT = 'light'

/** Which document array each drawing tool appends to. */
export const TOOL_TARGET = {
  [TOOL_WALL]: 'line_of_sight',
  [TOOL_OBJECT]: 'objects_line_of_sight',
  [TOOL_PORTAL]: 'portals',
  [TOOL_WINDOW]: 'portals',
  [TOOL_LIGHT]: 'lights',
}

/** Tools that build a multi-point polyline (click to add, double-click to end). */
export const POLYLINE_TOOLS = new Set([TOOL_WALL, TOOL_OBJECT])

/**
 * Tools that draw a portal — a door or a window — as a two-click line.
 *
 * Both write to `portals` and differ only in the `closed` flag, but they are
 * separate tools rather than one tool plus a toggle: drawing a window used to
 * mean placing a door, switching to select, clicking the door, and flipping it.
 * Four steps to say something the user knew before the first click.
 */
export const PORTAL_TOOLS = new Set([TOOL_PORTAL, TOOL_WINDOW])

/** `closed` for a portal drawn with this tool: a door blocks sight, a window does not. */
export const PORTAL_CLOSED = {
  [TOOL_PORTAL]: true,
  [TOOL_WINDOW]: false,
}

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

/**
 * The default sight and light radii for the player-view preview, in grid
 * squares. Preview-only: a `.uvtt` has no concept of a player token, so none of
 * this is written to the file.
 *
 * 4 squares of light is a torch at the 5ft-per-square most systems assume,
 * which is the case a GM is usually checking. Sight defaults to unlimited —
 * walls are what should stop you seeing, not an arbitrary radius.
 */
export const DEFAULT_PREVIEW = {
  sightRange: 0,
  lightRange: 4,
}

/**
 * How each tool is driven, shown in the sidebar while it is active.
 *
 * This exists because the gestures are not discoverable. Nothing on screen
 * tells you that a wall ends on a double-click, and a user who does not know
 * that is stuck mid-polyline with no way out that they can see — they cannot
 * even tell whether the tool is broken. The keys were always bound; only the
 * telling was missing.
 *
 * Each entry is a list of i18n key suffixes under `maps.vtt.help.<tool>`, so
 * the panel renders from this table rather than a switch.
 */
export const TOOL_HELP = {
  [TOOL_SELECT]: ['click', 'delete'],
  [TOOL_WALL]: ['click', 'finish', 'close', 'cancel', 'undo'],
  [TOOL_OBJECT]: ['click', 'finish', 'close', 'cancel', 'undo'],
  [TOOL_PORTAL]: ['click', 'cancel'],
  [TOOL_WINDOW]: ['click', 'cancel'],
  [TOOL_LIGHT]: ['click', 'edit'],
}

/** Shown for every tool: the gestures that never change. */
export const GLOBAL_HELP = ['pan', 'zoom', 'freeSnap']

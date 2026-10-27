/**
 * Ready-made lights, so placing a torch does not mean deriving one from a
 * colour picker and two sliders.
 *
 * **Where these numbers come from.** A `.uvtt` light carries only `position`,
 * `range`, `color`, `intensity` and `shadows` — there is no name, id, or kind
 * field anywhere in the format, so a fixture's *type* cannot be read back out
 * of an exported map. What the data does show, across ~1900 lights in the
 * sample maps in this repo, is that authored lights are highly repetitive:
 * only **79 distinct `(range, color, intensity)` triples** account for all of
 * them, and the 20 most common cover 77%. Those recurring triples are real
 * fixtures — a designer configures a sconce once and places it forty times.
 *
 * So the *values* below are measured: each is a triple that actually occurs,
 * at the frequency noted. The *names* are the inference — the format does not
 * label them, and nothing here can prove the 98-instance warm 7-square light
 * is what its author called a brazier. The names are chosen to match the
 * value's character (reach, hue, brightness), which is what makes them useful
 * as a starting point even where the original intent differed.
 *
 * Two things the raw data corrects about a from-scratch guess, and the reason
 * these are not hand-picked colours:
 *
 * - Authored colours are **dark and strongly saturated** (most sit at value
 *   0.2-0.5), not the bright hues a colour picker suggests. `intensity` does
 *   the brightening, so a "bright orange" torch colour double-counts it and
 *   blows out.
 * - **Intensity clusters at 0.5**, with a dimmer 0.16-0.35 band for small or
 *   ambient fixtures. Values above 1 are effectively unused.
 *
 * Alpha is `ff` and `shadows` is `true` in all 1927 samples without exception,
 * so neither is varied here.
 *
 * `range` is in grid squares and `color` is the format's ARGB hex exactly as
 * stored, so applying a preset is a plain field update with no conversion.
 */

/** The fallback when nothing else is chosen — matches `DEFAULT_LIGHT`. */
export const PRESET_CUSTOM = 'custom'

export const LIGHT_PRESETS = [
  // --- Small flames ---------------------------------------------------------
  // The most common 1-square light in the sample set, and the only bright-value
  // colour among them: a candle is small enough that the glow is the fixture.
  { id: 'candle', range: 1, intensity: 0.16, color: 'fff7ca50', shadows: true },
  { id: 'lantern', range: 1, intensity: 0.5, color: 'ff5a4f07', shadows: true },
  // --- Room fixtures --------------------------------------------------------
  { id: 'sconce', range: 2, intensity: 0.5, color: 'ff7b570a', shadows: true },
  { id: 'hearth', range: 3, intensity: 0.5, color: 'ff4e4404', shadows: true },
  { id: 'torch', range: 5, intensity: 0.25, color: 'fff79308', shadows: true },
  // --- Large fires ----------------------------------------------------------
  { id: 'brazier', range: 7, intensity: 0.5, color: 'ff633b03', shadows: true },
  { id: 'campfire', range: 13, intensity: 0.5, color: 'ff583709', shadows: true },
  { id: 'bonfire', range: 17, intensity: 0.5, color: 'ff493304', shadows: true },
  { id: 'daylight', range: 20, intensity: 0.5, color: 'ff633b03', shadows: true },
  // --- Cool and magical -----------------------------------------------------
  // The single most common light in the whole sample set (194 uses).
  { id: 'moonlight', range: 2, intensity: 0.5, color: 'ff2d5f6c', shadows: true },
  { id: 'swamp', range: 2, intensity: 0.3, color: 'ff274938', shadows: true },
  { id: 'arcane', range: 2, intensity: 0.5, color: 'ff76527a', shadows: true },
  { id: 'gloom', range: 3, intensity: 0.65, color: 'ff0c1815', shadows: true },
  // --- Neutral / ambient ----------------------------------------------------
  { id: 'ambient', range: 3, intensity: 0.5, color: 'ff424242', shadows: true },
  { id: 'shade', range: 2, intensity: 0.2, color: 'ff3d3d3d', shadows: true },
]

/** Look one up by id, or null for `custom` / anything unrecognised. */
export function findPreset(id) {
  return LIGHT_PRESETS.find((p) => p.id === id) || null
}

/**
 * Which preset a light already matches, or `custom`.
 *
 * Lets the picker show "Brazier" for a light that already carries those values
 * — including one that arrived in an imported map, which is common given how
 * few distinct triples real maps use — rather than reading as Custom every time
 * the panel is reopened. Compared on the three fields a preset sets, so a light
 * tuned away from its preset correctly goes back to custom.
 */
export function matchPreset(light) {
  if (!light) return PRESET_CUSTOM
  const hit = LIGHT_PRESETS.find(
    (p) =>
      p.range === light.range &&
      p.intensity === light.intensity &&
      p.color === (light.color || '').toLowerCase()
  )
  return hit ? hit.id : PRESET_CUSTOM
}

/**
 * A light with the preset's values applied, keeping its position.
 *
 * Position is explicitly preserved because a preset says what a light *is*, not
 * where it is — moving a placed light to the preset's origin would be a
 * surprising way to lose work.
 */
export function applyPreset(light, id) {
  const preset = findPreset(id)
  if (!preset) return light
  const { id: _id, ...values } = preset
  return { ...light, ...values }
}

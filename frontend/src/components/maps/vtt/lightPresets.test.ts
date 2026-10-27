import { describe, it, expect } from 'vitest'
import { LIGHT_PRESETS, PRESET_CUSTOM, applyPreset, findPreset, matchPreset } from './lightPresets'

describe('lightPresets', () => {
  it('ships presets that all carry the fields a light needs', () => {
    expect(LIGHT_PRESETS.length).toBeGreaterThan(0)
    for (const p of LIGHT_PRESETS) {
      expect(typeof p.id).toBe('string')
      expect(p.range).toBeGreaterThan(0)
      expect(p.intensity).toBeGreaterThan(0)
      // ARGB hex, alpha first, no leading '#'.
      expect(p.color).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('uses unique ids, so the picker cannot show two of the same', () => {
    const ids = LIGHT_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every preset within the range the real data uses', () => {
    // The sample maps top out at 46 squares and never exceed intensity 1;
    // a preset outside that band would not be a value Dungeondraft writes.
    for (const p of LIGHT_PRESETS) {
      expect(p.range).toBeLessThanOrEqual(46)
      expect(p.intensity).toBeLessThanOrEqual(1)
      // Alpha is 'ff' and shadows are on in all 1927 observed lights.
      expect(p.color.slice(0, 2)).toBe('ff')
      expect(p.shadows).toBe(true)
    }
  })

  it('finds a preset by id and nothing for custom', () => {
    expect(findPreset('torch')).toMatchObject({ id: 'torch' })
    expect(findPreset(PRESET_CUSTOM)).toBeNull()
    expect(findPreset('nope')).toBeNull()
  })

  it('applies a preset while keeping the light where it was placed', () => {
    // A preset says what a light *is*, not where — moving it would be a
    // surprising way to lose the placement.
    const light = { position: { x: 4, y: 7 }, range: 1, intensity: 0.1, color: 'ff000000' }
    const out = applyPreset(light, 'torch')
    expect(out.position).toEqual({ x: 4, y: 7 })
    expect(out).toMatchObject({ range: 5, intensity: 0.25, color: 'fff79308' })
    // The preset's own id is not a light field and must not leak into the doc.
    expect(out.id).toBeUndefined()
  })

  it('leaves the light untouched for an unknown preset', () => {
    const light = { position: { x: 1, y: 1 }, range: 3, intensity: 0.5, color: 'ffffffff' }
    expect(applyPreset(light, 'nope')).toBe(light)
  })

  it('recognises a light that already matches a preset', () => {
    const torch = LIGHT_PRESETS.find((p) => p.id === 'torch')
    expect(matchPreset({ position: { x: 0, y: 0 }, ...torch })).toBe('torch')
  })

  it('reads a tuned light as custom again', () => {
    const torch = LIGHT_PRESETS.find((p) => p.id === 'torch')
    expect(matchPreset({ ...torch, range: torch.range + 2 })).toBe(PRESET_CUSTOM)
  })

  it('matches case-insensitively, since stored colour casing varies', () => {
    const torch = LIGHT_PRESETS.find((p) => p.id === 'torch')
    expect(matchPreset({ ...torch, color: torch.color.toUpperCase() })).toBe('torch')
  })

  it('calls a missing light custom rather than throwing', () => {
    expect(matchPreset(null)).toBe(PRESET_CUSTOM)
    expect(matchPreset({})).toBe(PRESET_CUSTOM)
  })

  it('round-trips: applying a preset makes it match that preset', () => {
    const light = { position: { x: 2, y: 2 }, range: 0, intensity: 0, color: 'ff000000' }
    for (const p of LIGHT_PRESETS) {
      expect(matchPreset(applyPreset(light, p.id))).toBe(p.id)
    }
  })
})

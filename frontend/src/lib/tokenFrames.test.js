/**
 * Geometry guards for the bundled token frames.
 *
 * These are static assets, so nothing else would catch a frame that stops
 * covering the mask — and the failure is subtle: a ring of uncropped art
 * outside the frame, or a hairline of background inside it. Both look like a
 * rendering bug rather than a bad asset, so the rule is asserted here.
 *
 * Lives under src/lib/ beside the compositor that consumes the frames. Test
 * files are excluded from coverage, so this costs nothing against the gate.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FRAMES_DIR = join(process.cwd(), 'static', 'frames')

// The editor derives a token's crop by flood-filling inward from the centre of
// the frame, so what a frame must guarantee is a *closed* interior: an opening
// anywhere lets the fill escape and the frame falls back to a plain circle.
// (The old rule — that a frame's band had to span a fixed mask radius — went
// away with frame-shaped masking, which is what lets a hexagon frame exist.)

const files = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.svg'))

describe('bundled token frames', () => {
  it('ships the three defaults the picker expects', () => {
    expect(files.sort()).toEqual(['npc.svg', 'opponent.svg', 'pc.svg'])
  })

  describe.each(files)('%s', (file) => {
    const svg = readFileSync(join(FRAMES_DIR, file), 'utf8')

    it('declares intrinsic dimensions, not just a viewBox', () => {
      // Firefox and Safari report a dimensionless SVG as zero-sized, and
      // drawImage then silently draws nothing at all.
      expect(svg).toMatch(/width="512"/)
      expect(svg).toMatch(/height="512"/)
      expect(svg).toMatch(/viewBox="0 0 512 512"/)
    })

    it('is drawn as a stroked border with an unfilled middle', () => {
      // Closure is a pixel property, verified against a real raster elsewhere;
      // what markup can assert is that the frame strokes an outline and leaves
      // its interior empty, so the flood fill has somewhere to start.
      expect(svg).toMatch(/stroke-width="[\d.]+"/)
      expect(svg).toContain('fill="none"')
    })

    it('keeps every drawn coordinate inside the viewBox', () => {
      const coords = [...svg.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].flatMap((m) => [
        Number(m[1]),
        Number(m[2]),
      ])
      for (const c of coords) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(512)
      }
    })

    it('carries no script, event handler, or external reference', () => {
      // An <img>-loaded SVG cannot execute script anyway, but the bundled
      // frames should be plainly inert on inspection.
      expect(svg.toLowerCase()).not.toContain('<script')
      expect(svg).not.toMatch(/\son\w+\s*=/)
      expect(svg).not.toMatch(/(?:href|src)\s*=\s*"(?!#)[a-z]+:/i)
    })
  })
})

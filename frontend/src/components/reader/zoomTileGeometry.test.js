import { describe, it, expect } from 'vitest'
import {
  TILE_MAX_WIDTH,
  TILE_SIZE,
  TILE_WIDTH_STEP,
  needsTiles,
  tileGrid,
  tileRect,
  tileWidthFor,
  visibleTiles,
} from './zoomTileGeometry'

describe('tileWidthFor', () => {
  it('renders one image pixel per device pixel, rounded up to the step', () => {
    // 800 CSS px at 3x on a 1x screen is 2400, stepped up to 2560.
    expect(tileWidthFor(800, 3, 1)).toBe(2560)
    expect(tileWidthFor(800, 3, 1) % TILE_WIDTH_STEP).toBe(0)
  })

  it('counts screen density, up to 2x', () => {
    expect(tileWidthFor(800, 3, 2)).toBe(4864)
    expect(tileWidthFor(800, 3, 3)).toBe(tileWidthFor(800, 3, 2))
    expect(tileWidthFor(800, 3, undefined)).toBe(tileWidthFor(800, 3, 1))
  })

  it('stays inside what the server accepts', () => {
    expect(tileWidthFor(4000, 8, 2)).toBe(TILE_MAX_WIDTH)
    expect(tileWidthFor(10, 1, 1)).toBe(TILE_WIDTH_STEP)
  })
})

describe('needsTiles', () => {
  it('only once the whole-page image is visibly short of sharp', () => {
    expect(needsTiles(3072, 3000)).toBe(false)
    expect(needsTiles(4096, 3000)).toBe(true)
  })
})

describe('tileGrid', () => {
  it('covers the whole page, cutting the last row and column short', () => {
    // US Letter (792/612) at 2048 wide is 2650 tall: 2 columns, 3 rows.
    expect(tileGrid(2048, 792 / 612)).toEqual({ cols: 2, rows: 3 })
  })
})

describe('tileRect', () => {
  it('places a tile as percentages of the page box', () => {
    expect(tileRect(1, 0, 2048, 1)).toEqual({
      left: '50.0000%',
      top: '0.0000%',
      width: '50.0000%',
      height: '50.0000%',
    })
  })

  it('cuts edge tiles to the page', () => {
    // 1280 wide: the second column is 256px, a fifth of the page.
    expect(tileRect(1, 0, 1280, 1).width).toBe('20.0000%')
  })
})

describe('visibleTiles', () => {
  const width = 4096 // 4 x 4 tiles of a square page
  const box = { left: -1000, top: -1000, width: 4000, height: 4000 }

  it('returns the tiles the view overlaps first, then a ring around them', () => {
    // The view sees 1000..2500 of the 4000px box across and down: page pixels
    // 1024..2560, so the second and third tiles each way.
    const view = { left: 0, top: 0, width: 1500, height: 1500 }
    const tiles = visibleTiles({ width, aspect: 1, box, view })
    const high = tiles.filter((t) => t.priority === 'high')
    expect(high.map(({ col, row }) => `${col}:${row}`)).toEqual(['1:1', '2:1', '1:2', '2:2'])
    expect(tiles.indexOf(high.at(-1))).toBe(high.length - 1)
    // The ring adds the tiles around them without repeating any.
    const keys = tiles.map(({ col, row }) => `${col}:${row}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('0:0')
    expect(keys).toContain('3:3')
  })

  it('clamps the ring at the page edge', () => {
    const view = { left: -1000, top: -1000, width: 500, height: 500 }
    const tiles = visibleTiles({ width, aspect: 1, box, view })
    expect(tiles.every(({ col, row }) => col >= 0 && row >= 0)).toBe(true)
    expect(tiles.filter((t) => t.priority === 'high')).toEqual([
      { col: 0, row: 0, priority: 'high' },
    ])
  })

  it('returns nothing for a page that is off screen or not laid out', () => {
    const view = { left: 5000, top: 5000, width: 100, height: 100 }
    expect(visibleTiles({ width, aspect: 1, box, view })).toEqual([])
    expect(visibleTiles({ width, aspect: 1, box: { ...box, width: 0 }, view })).toEqual([])
  })

  it('uses the server tile size', () => {
    expect(TILE_SIZE).toBe(1024)
  })
})

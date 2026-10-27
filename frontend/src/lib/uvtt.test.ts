import { describe, it, expect } from 'vitest'
import {
  UVTT_FORMAT,
  buildUvtt,
  documentFromUvtt,
  gridFromUvtt,
  imageUrlFromUvtt,
  isUvttName,
  readUvttFile,
  sniffImageMime,
} from './uvtt'

// A one-pixel PNG, base64 as a .uvtt would carry it.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const envelope = (over = {}) => ({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 6, y: 4 }, pixels_per_grid: 100 },
  line_of_sight: [
    [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  ],
  objects_line_of_sight: [],
  portals: [
    {
      bounds: [
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ],
      closed: true,
    },
  ],
  lights: [{ position: { x: 2, y: 2 }, range: 3, color: 'ffeccd8b' }],
  environment: { baked_lighting: true, ambient_light: 'ff112233' },
  image: PNG_B64,
  ...over,
})

const fakeFile = (text) => ({ text: () => Promise.resolve(text) })

describe('isUvttName', () => {
  it('matches both extensions regardless of case', () => {
    expect(isUvttName('a.uvtt')).toBe(true)
    expect(isUvttName('a.DD2VTT')).toBe(true)
    expect(isUvttName('a.png')).toBe(false)
    expect(isUvttName(null)).toBe(false)
  })
})

describe('documentFromUvtt', () => {
  it('reads walls, portals, lights and environment', () => {
    const doc = documentFromUvtt(envelope())
    expect(doc.line_of_sight).toEqual([
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    ])
    expect(doc.portals[0].bounds).toHaveLength(2)
    expect(doc.lights[0].color).toBe('ffeccd8b')
    expect(doc.environment).toEqual({ baked_lighting: true, ambient_light: 'ff112233' })
  })

  it('reads keys whatever their casing', () => {
    // A file written with "Line_Of_Sight" is perfectly valid and would
    // otherwise appear to have no walls at all.
    const doc = documentFromUvtt({
      Line_Of_Sight: [
        [
          { X: 1, Y: 1 },
          { X: 2, Y: 2 },
        ],
      ],
    })
    expect(doc.line_of_sight).toEqual([
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    ])
  })

  it('drops a portal with no bounds', () => {
    // bounds is the load-bearing field: without it the door cannot be placed.
    const doc = documentFromUvtt(envelope({ portals: [{ position: { x: 5, y: 5 } }] }))
    expect(doc.portals).toEqual([])
  })

  it('drops a polyline too short to be a wall', () => {
    const doc = documentFromUvtt(envelope({ line_of_sight: [[{ x: 0, y: 0 }]] }))
    expect(doc.line_of_sight).toEqual([])
  })

  it('defaults an unreadable colour rather than exporting a wrong one', () => {
    const doc = documentFromUvtt(
      envelope({ lights: [{ position: { x: 0, y: 0 }, color: 'not-a-colour' }] })
    )
    expect(doc.lights[0].color).toBe('ffffffff')
  })

  it('expands 6-digit RGB to opaque ARGB', () => {
    const doc = documentFromUvtt(
      envelope({ lights: [{ position: { x: 0, y: 0 }, color: '#eccd8b' }] })
    )
    expect(doc.lights[0].color).toBe('ffeccd8b')
  })

  it('survives a file with no sections at all', () => {
    const doc = documentFromUvtt({})
    expect(doc.line_of_sight).toEqual([])
    expect(doc.environment.ambient_light).toBe('00000000')
  })

  it('defaults closed and shadows to true', () => {
    // A door that silently became a window would change what players can see.
    const doc = documentFromUvtt(
      envelope({
        portals: [
          {
            bounds: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        ],
      })
    )
    expect(doc.portals[0].closed).toBe(true)
    expect(doc.lights[0].shadows).toBe(true)
  })
})

describe('gridFromUvtt', () => {
  it('reads the stated cell size and extent', () => {
    expect(gridFromUvtt(envelope())).toEqual({ pixelsPerGrid: 100, width: 6, height: 4 })
  })

  it('reports zero when the file states nothing usable', () => {
    expect(gridFromUvtt({}).pixelsPerGrid).toBe(0)
    expect(gridFromUvtt({ resolution: { pixels_per_grid: 0 } }).pixelsPerGrid).toBe(0)
  })
})

describe('sniffImageMime', () => {
  it.each([
    ['\x89PNG\r\n\x1a\n', 'image/png'],
    ['\xff\xd8\xff\xe0', 'image/jpeg'],
    ['RIFF____WEBP', 'image/webp'],
    ['GIF89a', 'image/gif'],
    ['garbage!', 'application/octet-stream'],
  ])('detects %j', (head, expected) => {
    expect(sniffImageMime(head)).toBe(expected)
  })
})

describe('imageUrlFromUvtt', () => {
  it('builds a data URL with the sniffed type', () => {
    expect(imageUrlFromUvtt(envelope())).toBe(`data:image/png;base64,${PNG_B64}`)
  })

  it('passes a full data URI through untouched', () => {
    const uri = 'data:image/webp;base64,AAAA'
    expect(imageUrlFromUvtt({ image: uri })).toBe(uri)
  })

  it('is null when there is no image', () => {
    expect(imageUrlFromUvtt({})).toBeNull()
    expect(imageUrlFromUvtt({ image: '' })).toBeNull()
  })
})

describe('readUvttFile', () => {
  it('returns the image, document and grid together', async () => {
    const out = await readUvttFile(fakeFile(JSON.stringify(envelope())))
    expect(out.imageUrl).toContain('data:image/png;base64,')
    expect(out.doc.lights).toHaveLength(1)
    expect(out.grid.pixelsPerGrid).toBe(100)
  })

  it('tolerates a UTF-8 BOM', async () => {
    // Some exporters write one, and JSON.parse rejects it outright.
    const out = await readUvttFile(fakeFile('﻿' + JSON.stringify(envelope())))
    expect(out.grid.pixelsPerGrid).toBe(100)
  })

  it('rejects a file that is not JSON', async () => {
    await expect(readUvttFile(fakeFile('<html>'))).rejects.toThrow('not-json')
  })

  it('rejects JSON that is not an envelope', async () => {
    await expect(readUvttFile(fakeFile('[1,2,3]'))).rejects.toThrow('not-uvtt')
  })

  it('rejects an envelope carrying no picture', async () => {
    // There is nothing to draw walls over, so this cannot be edited.
    const { image, ...noImage } = envelope()
    await expect(readUvttFile(fakeFile(JSON.stringify(noImage)))).rejects.toThrow('no-image')
  })
})

describe('buildUvtt', () => {
  const doc = documentFromUvtt(envelope())

  it('writes the envelope an importer expects', () => {
    const out = buildUvtt({
      imageBase64: PNG_B64,
      pixelWidth: 600,
      pixelHeight: 400,
      cellPx: 100,
      doc,
    })
    expect(out.format).toBe(UVTT_FORMAT)
    expect(out.resolution).toEqual({
      map_origin: { x: 0, y: 0 },
      map_size: { x: 6, y: 4 },
      pixels_per_grid: 100,
    })
    expect(out.image).toBe(PNG_B64)
  })

  it('derives a portal position and rotation from its bounds', () => {
    const out = buildUvtt({ imageBase64: '', pixelWidth: 600, pixelHeight: 400, cellPx: 100, doc })
    const p = out.portals[0]
    // Both are emitted because importers read one or the other, and both are
    // derived so they can never contradict the bounds.
    expect(p.position).toEqual({ x: 3.5, y: 0 })
    expect(p.rotation).toBe(0)
    expect(p.bounds).toEqual([
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ])
  })

  it('falls back to the default cell size rather than dividing by zero', () => {
    const out = buildUvtt({ imageBase64: '', pixelWidth: 1400, pixelHeight: 1400, cellPx: 0, doc })
    expect(out.resolution.pixels_per_grid).toBe(140)
    expect(out.resolution.map_size).toEqual({ x: 10, y: 10 })
  })

  it('emits every array even with nothing authored', () => {
    // The envelope shape must not depend on whether the map was edited.
    const out = buildUvtt({ imageBase64: '', pixelWidth: 100, pixelHeight: 100, cellPx: 100 })
    expect(out.line_of_sight).toEqual([])
    expect(out.portals).toEqual([])
    expect(out.lights).toEqual([])
    expect(out.environment).toEqual({ baked_lighting: false, ambient_light: '00000000' })
  })

  it('round-trips a document unchanged', () => {
    const built = buildUvtt({
      imageBase64: PNG_B64,
      pixelWidth: 600,
      pixelHeight: 400,
      cellPx: 100,
      doc,
    })
    // What matters is that a file we write reads back as the same drawing.
    expect(documentFromUvtt(built)).toEqual(doc)
  })

  it('does not alias the source document', () => {
    const out = buildUvtt({ imageBase64: '', pixelWidth: 600, pixelHeight: 400, cellPx: 100, doc })
    out.line_of_sight[0][0].x = 999
    expect(doc.line_of_sight[0][0].x).toBe(1)
  })
})

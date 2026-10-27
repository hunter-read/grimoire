import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../api', () => ({
  tokenFrames: {
    list: vi.fn(),
    fileUrl: (id) => `/api/token-frames/${id}/file`,
  },
}))

import { tokenFrames } from '../../../api'
import {
  BUILTIN_FRAMES,
  GENERIC_FRAMES,
  fetchFrames,
  frameIsRecolourable,
  frameLabel,
  frameUrl,
  groupFrames,
  isBuiltinFrame,
  matchesFrameQuery,
} from './frames'

beforeEach(() => vi.clearAllMocks())

describe('BUILTIN_FRAMES', () => {
  it('ships the three default shapes as static assets', () => {
    expect(BUILTIN_FRAMES).toHaveLength(3)
    expect(BUILTIN_FRAMES.map((f) => f.id)).toEqual([
      'builtin:pc',
      'builtin:npc',
      'builtin:opponent',
    ])
    // Static paths, so they render with no API call and no auth.
    BUILTIN_FRAMES.forEach((f) => expect(f.url).toMatch(/^\/frames\/.+\.svg$/))
  })
})

describe('frameUrl', () => {
  it('resolves a built-in to its bundled path', () => {
    expect(frameUrl('builtin:pc')).toBe('/frames/pc.svg')
    expect(frameUrl({ id: 'builtin:npc' })).toBe('/frames/npc.svg')
  })

  it('resolves a user frame through the API', () => {
    expect(frameUrl('dG9rZW5z')).toBe('/api/token-frames/dG9rZW5z/file')
  })

  it('returns null for nothing selected or an unknown built-in', () => {
    expect(frameUrl(null)).toBeNull()
    expect(frameUrl({})).toBeNull()
    expect(frameUrl('builtin:nope')).toBeNull()
  })
})

describe('generic frames', () => {
  it('offers two recolourable shapes', () => {
    expect(GENERIC_FRAMES.map((f) => f.id)).toEqual(['generic:circle', 'generic:square'])
  })

  it('renders a generic in the requested colour', () => {
    const url = frameUrl('generic:circle', 'blue')
    expect(url.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(url)).toContain('#5590d4')
  })

  it('marks only the generics as recolourable', () => {
    expect(frameIsRecolourable('generic:square')).toBe(true)
    expect(frameIsRecolourable('builtin:pc')).toBe(false)
    expect(frameIsRecolourable('dG9rZW5z')).toBe(false)
  })

  it('ignores a colour for frames that are files', () => {
    expect(frameUrl('builtin:pc', 'blue')).toBe('/frames/pc.svg')
  })
})

describe('isBuiltinFrame', () => {
  it('distinguishes bundled ids from server ids', () => {
    expect(isBuiltinFrame('builtin:pc')).toBe(true)
    // Server ids are base64url, which never contains a colon.
    expect(isBuiltinFrame('dG9rZW5zLy5mcmFtZXM')).toBe(false)
    expect(isBuiltinFrame(undefined)).toBe(false)
  })
})

describe('fetchFrames', () => {
  it('leads with the generic shapes, then the themed frames, then user frames', async () => {
    tokenFrames.list.mockResolvedValue({
      frames: [{ id: 'abc', name: 'orc ring', group: 'Fantasy', format: 'svg' }],
    })
    const frames = await fetchFrames()
    const bundled = GENERIC_FRAMES.length + BUILTIN_FRAMES.length
    expect(frames).toHaveLength(bundled + 1)
    expect(frames.slice(0, GENERIC_FRAMES.length).every((f) => f.generic)).toBe(true)
    expect(frames.slice(0, bundled).every((f) => f.builtin)).toBe(true)
    expect(frames.at(-1)).toMatchObject({ id: 'abc', name: 'orc ring', builtin: false })
  })

  it('falls back to the bundled frames when the library cannot be read', async () => {
    tokenFrames.list.mockRejectedValue(new Error('nope'))
    const frames = await fetchFrames()
    expect(frames).toHaveLength(GENERIC_FRAMES.length + BUILTIN_FRAMES.length)
    expect(frames.every((f) => f.builtin)).toBe(true)
  })

  it('tolerates a malformed response', async () => {
    tokenFrames.list.mockResolvedValue({})
    expect(await fetchFrames()).toHaveLength(GENERIC_FRAMES.length + BUILTIN_FRAMES.length)
  })
})

describe('groupFrames', () => {
  it('separates built-ins from user folders and keeps order', () => {
    const groups = groupFrames([
      { id: 'builtin:pc', builtin: true },
      { id: 'a', builtin: false, group: '' },
      { id: 'b', builtin: false, group: 'Fantasy' },
      { id: 'c', builtin: false, group: 'Fantasy' },
    ])
    expect(groups.map((g) => g.key)).toEqual(['builtin', 'user:', 'user:Fantasy'])
    expect(groups[2].frames).toHaveLength(2)
    expect(groups[2].label).toBe('Fantasy')
  })

  it('returns nothing for an empty catalogue', () => {
    expect(groupFrames([])).toEqual([])
  })
})

describe('frameLabel', () => {
  const t = (key) => `T:${key}`

  it('translates built-ins and shows user names verbatim', () => {
    expect(frameLabel({ builtin: true, nameKey: 'tokenEditor.framePc' }, t)).toBe(
      'T:tokenEditor.framePc'
    )
    expect(frameLabel({ builtin: false, name: 'orc ring' }, t)).toBe('orc ring')
    expect(frameLabel(null, t)).toBe('')
  })
})

describe('matchesFrameQuery', () => {
  const t = (key) => (key === 'tokenEditor.framePc' ? 'Player character' : key)
  const frame = { builtin: false, name: 'orc ring', group: 'Fantasy Frames' }

  it('matches everything on an empty or whitespace query', () => {
    expect(matchesFrameQuery(frame, '', t)).toBe(true)
    expect(matchesFrameQuery(frame, '   ', t)).toBe(true)
    expect(matchesFrameQuery(frame, undefined, t)).toBe(true)
  })

  it('matches the frame name, case-insensitively', () => {
    expect(matchesFrameQuery(frame, 'ORC', t)).toBe(true)
    expect(matchesFrameQuery(frame, 'ring', t)).toBe(true)
    expect(matchesFrameQuery(frame, 'goblin', t)).toBe(false)
  })

  it('matches the folder, so a user can search by where a frame lives', () => {
    expect(matchesFrameQuery(frame, 'fantasy', t)).toBe(true)
  })

  it('matches a built-in through its translated label', () => {
    expect(matchesFrameQuery({ builtin: true, nameKey: 'tokenEditor.framePc' }, 'player', t)).toBe(
      true
    )
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesFrameQuery(frame, '  orc  ', t)).toBe(true)
  })

  it('rejects a missing frame rather than throwing', () => {
    expect(matchesFrameQuery(null, 'orc', t)).toBe(false)
  })

  it('tolerates a frame with no group', () => {
    expect(matchesFrameQuery({ builtin: false, name: 'plain' }, 'plain', t)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  MEDIA_CONFIGS,
  getFolderPath,
  getTopFolder,
  getSubPath,
  getFolderAncestors,
  getEffectiveTags,
} from './mediaConfig'

describe('MEDIA_CONFIGS', () => {
  it('defines map, token, and audio configs', () => {
    expect(MEDIA_CONFIGS.map.type).toBe('map')
    expect(MEDIA_CONFIGS.token.type).toBe('token')
    expect(MEDIA_CONFIGS.audio.type).toBe('audio')
  })

  it('audio config exposes file/artwork urls and an artwork thumbnail flag', () => {
    const a = MEDIA_CONFIGS.audio
    expect(a.audioFileUrl('x')).toBe('/audio/x/file')
    expect(a.thumbnailUrl('x')).toBe('/audio/x/artwork')
    expect(a.thumbnailFlag).toBe('has_artwork')
    expect(a.itemUrl('x')).toBe('/audio/x')
    expect(a.detailPath('x')).toBe('/audio/x')
    expect(a.archiveType).toBe('audio_folder')
  })

  it('map/token configs have no audioFileUrl', () => {
    expect(MEDIA_CONFIGS.map.audioFileUrl).toBeUndefined()
    expect(MEDIA_CONFIGS.token.audioFileUrl).toBeUndefined()
  })

  it('map and token url builders produce the expected paths', () => {
    const m = MEDIA_CONFIGS.map
    expect(m.itemUrl('x')).toBe('/maps/x')
    expect(m.thumbnailUrl('x')).toBe('/maps/x/thumbnail')
    expect(m.detailPath('x')).toBe('/maps/x')
    const tk = MEDIA_CONFIGS.token
    expect(tk.itemUrl('y')).toBe('/tokens/y')
    expect(tk.thumbnailUrl('y')).toBe('/tokens/y/thumbnail')
    expect(tk.detailPath('y')).toBe('/tokens/y')
  })
})

describe('folder path helpers', () => {
  const item = (rp) => ({ relative_path: rp })

  it('getFolderPath drops the collection prefix and filename', () => {
    expect(getFolderPath(item('audio/Ambient/Sub/track.mp3'))).toBe('Ambient/Sub')
  })

  it('getTopFolder returns the first folder or (Root)', () => {
    expect(getTopFolder(item('audio/Ambient/track.mp3'))).toBe('Ambient')
    expect(getTopFolder(item('audio/track.mp3'))).toBe('(Root)')
  })

  it('getSubPath returns the path below the top folder', () => {
    expect(getSubPath(item('audio/Ambient/Sub/track.mp3'))).toBe('Sub')
    expect(getSubPath(item('audio/Ambient/track.mp3'))).toBe('')
  })

  it('handles backslash separators', () => {
    expect(getTopFolder(item('audio\\Ambient\\track.mp3'))).toBe('Ambient')
  })
})

describe('getFolderAncestors', () => {
  const item = (rp) => ({ relative_path: rp })

  it('lists every folder from the item up to the top level', () => {
    expect(getFolderAncestors(item('maps/Fall Of Blackbottom/Alleyways/Map1.png'))).toEqual([
      'Fall Of Blackbottom/Alleyways',
      'Fall Of Blackbottom',
    ])
  })

  it('returns the single folder for a shallow item', () => {
    expect(getFolderAncestors(item('maps/Fall Of Blackbottom/Map1.png'))).toEqual([
      'Fall Of Blackbottom',
    ])
  })

  it('returns nothing for an item at the collection root', () => {
    expect(getFolderAncestors(item('maps/Map1.png'))).toEqual([])
  })

  it('handles backslash separators', () => {
    expect(getFolderAncestors(item('maps\\Town\\Inn\\Map1.png'))).toEqual(['Town/Inn', 'Town'])
  })
})

describe('getEffectiveTags', () => {
  const nested = { relative_path: 'maps/Fall Of Blackbottom/Alleyways/Map1.png', tags: ['night'] }

  it('inherits a tag set on an ancestor folder', () => {
    expect(getEffectiveTags(nested, { 'Fall Of Blackbottom': ['urban'] })).toEqual([
      'night',
      'urban',
    ])
  })

  it('combines the item, its own folder, and every folder above it', () => {
    const tags = getEffectiveTags(nested, {
      'Fall Of Blackbottom': ['urban'],
      'Fall Of Blackbottom/Alleyways': ['cramped'],
    })
    expect(tags).toEqual(['night', 'cramped', 'urban'])
  })

  it('de-duplicates case-insensitively, keeping the first casing seen', () => {
    expect(getEffectiveTags(nested, { 'Fall Of Blackbottom': ['Night', 'urban'] })).toEqual([
      'night',
      'urban',
    ])
  })

  it('ignores folder tags that belong to an unrelated folder', () => {
    expect(getEffectiveTags(nested, { Elsewhere: ['desert'] })).toEqual(['night'])
  })

  it('returns just the item tags when no folder tags are given', () => {
    expect(getEffectiveTags(nested)).toEqual(['night'])
  })
})

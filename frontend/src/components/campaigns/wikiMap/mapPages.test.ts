import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../api', () => ({
  mediaUrl: (path: string, params: Record<string, unknown> = {}) =>
    `/api${path}?${new URLSearchParams(params as Record<string, string>)}`,
  campaigns: { fileUrl: (cid: string, id: string) => `/api/campaigns/${cid}/files/${id}` },
}))

import { isImageMapName, mapImageUrl, pinName } from './mapPages'

describe('mapPages', () => {
  it('knows the maps a page can show', () => {
    expect(isImageMapName('Coast.JPEG')).toBe(true)
    expect(isImageMapName('atlas.pdf')).toBe(false)
    expect(isImageMapName(null)).toBe(false)
  })

  it('builds the picture URL for each source', () => {
    expect(mapImageUrl('c1', { source: 'library', id: 'm1', has_thumbnail: false })).toBe(
      '/api/maps/m1/page/1?width=3000'
    )
    expect(mapImageUrl('c1', { source: 'file', id: 'f1', has_thumbnail: true })).toBe(
      '/api/campaigns/c1/files/f1'
    )
    expect(mapImageUrl('c1', { source: 'missing', has_thumbnail: false })).toBeNull()
    expect(mapImageUrl('c1', null)).toBeNull()
  })

  it('names a pin by its label, else its page', () => {
    expect(pinName({ label: 'Gate', target_title: 'Town' })).toBe('Gate')
    expect(pinName({ label: '', target_title: 'Town' })).toBe('Town')
    expect(pinName({ label: '', target_title: null })).toBe('')
  })
})

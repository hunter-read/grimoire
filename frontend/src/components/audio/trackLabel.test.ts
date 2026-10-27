import { describe, expect, it } from 'vitest'
import { stripExtension, trackDetails, trackLabel } from './trackLabel'

describe('stripExtension', () => {
  it('drops only the last extension', () => {
    expect(stripExtension('01 - Thorwal das Land der Mutigen.mp3')).toBe(
      '01 - Thorwal das Land der Mutigen'
    )
    expect(stripExtension('mix.v2.flac')).toBe('mix.v2')
  })

  it('leaves names without one alone', () => {
    expect(stripExtension('README')).toBe('README')
    expect(stripExtension('.hidden')).toBe('.hidden')
    expect(stripExtension()).toBe('')
  })
})

describe('trackLabel', () => {
  it('leads a titled track with its zero-padded number', () => {
    expect(trackLabel({ filename: '', title: 'Die Sümpfe Harodiens', track_number: 3 })).toBe(
      '03 · Die Sümpfe Harodiens'
    )
    expect(trackLabel({ filename: '', title: 'Finale', track_number: 112 })).toBe('112 · Finale')
  })

  it('shows a title alone when there is no track number', () => {
    expect(trackLabel({ filename: '', title: 'Thorwal', track_number: null })).toBe('Thorwal')
  })

  it('falls back to the filename without its extension', () => {
    expect(trackLabel({ title: '', track_number: 4, filename: '04 - Gestade.mp3' })).toBe(
      '04 - Gestade'
    )
  })

  it('keeps an archive filename whole', () => {
    expect(trackLabel({ is_archive: true, filename: 'pack.zip', title: '' })).toBe('pack.zip')
  })
})

describe('trackDetails', () => {
  it('joins artist, album and duration', () => {
    expect(trackDetails({ artist: 'Sphärenklang', album: 'Thorwal', duration: 3725 })).toBe(
      'Sphärenklang · Thorwal · 1:02:05'
    )
  })

  it('skips whichever tag is missing', () => {
    expect(trackDetails({ artist: '', album: 'Thorwal', duration: 0 })).toBe('Thorwal')
  })

  it('shows the size in place of absent tags', () => {
    expect(trackDetails({ file_size: 2048, duration: 61 })).toBe('2.0 KB · 1:01')
    expect(trackDetails({})).toBe('0 B')
  })
})

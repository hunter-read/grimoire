import { describe, expect, it } from 'vitest'
import { LANGUAGE_NAMES } from './languages'

const files = import.meta.glob<{ _meta?: { nativeName?: string } }>('./*.json', {
  import: 'default',
  eager: true,
})
const fromFiles = Object.fromEntries(
  Object.entries(files).map(([path, data]) => [
    path.match(/\.\/(.+)\.json$/)![1],
    data._meta?.nativeName,
  ])
)

describe('LANGUAGE_NAMES', () => {
  it('lists every locale file under the name its _meta gives it', () => {
    expect(LANGUAGE_NAMES).toEqual(fromFiles)
  })
})

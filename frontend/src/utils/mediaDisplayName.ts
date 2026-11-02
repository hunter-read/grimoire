/**
 * A media file's name as a person would say it: "forest_camp-30x20.webp" →
 * "forest camp 30x20".
 *
 * Maps, tokens and models carry only their filename, which is a poor thing for a
 * screen reader to read as an image's alt text or a button's target - the
 * extension and the underscores are noise. The visible title keeps the real
 * filename; this is for the spoken name.
 */
export function mediaDisplayName(filename: string | null | undefined): string {
  const base = (filename || '').replace(/\\/g, '/').split('/').pop() || ''
  const name = base
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name || base
}

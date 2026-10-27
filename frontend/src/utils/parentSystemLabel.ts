/**
 * Combine a system's parent_system and edition into a single display label.
 * "Cyberpunk" + "Red" → "Cyberpunk Red"; either part may be empty.
 */
export function parentSystemLabel(
  system: { parent_system?: string | null; edition?: string | null } | null | undefined
): string {
  if (!system) return ''
  const parent = (system.parent_system || '').trim()
  const edition = (system.edition || '').trim()
  return [parent, edition].filter(Boolean).join(' ')
}

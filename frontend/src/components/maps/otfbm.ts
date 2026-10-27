/**
 * The Avrae `!map` command for an OTFBM background (issue #551).
 *
 * `plan` is the server's `GET /maps/:id/otfbm` answer and `imageUrl` the
 * background's public URL - normally the file URL of an OTFBM share link. A
 * placeholder stands in when there is no URL yet.
 */
export const OTFBM_URL_PLACEHOLDER = '<image-url>'

export function otfbmCommand(
  plan: { width: number; height: number; cell: number | string } | null | undefined,
  imageUrl = ''
): string {
  if (!plan) return ''
  const url = imageUrl.trim() || OTFBM_URL_PLACEHOLDER
  return `!map -mapsize ${plan.width}x${plan.height} -options c${plan.cell} -bg ${url}`
}

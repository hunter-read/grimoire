/**
 * Marks a token folder whose images are token-editor frames (overlay art).
 *
 * The same signal the file manager gives such a folder, repeated in the gallery
 * because that is where someone browsing tokens actually meets the folder — and
 * a folder full of rings and borders is otherwise indistinguishable from a
 * folder of character art until you open the editor.
 */
export default function FramesBadge({ label }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        background: 'var(--bg-card-hover)',
        color: 'var(--gold)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}

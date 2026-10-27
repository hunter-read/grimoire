/** Small uppercase pill labelling the viewer's relationship to a campaign. */
export default function CampaignRoleBadge({ label }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'var(--bg-panel)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
  )
}

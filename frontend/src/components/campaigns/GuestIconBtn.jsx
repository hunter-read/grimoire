/** Small icon-only action button used in the guest list rows. */
export default function GuestIconBtn({ children, title, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 6,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

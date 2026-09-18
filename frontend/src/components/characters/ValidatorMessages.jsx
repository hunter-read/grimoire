import { LuTriangleAlert, LuCircleAlert } from 'react-icons/lu'

/**
 * The schema validators currently firing against a character.
 *
 * Errors first, then warnings — an error is something the sheet says is wrong,
 * a warning is something it says is worth a look, and a player scanning this
 * should hit the former first.
 *
 * Nothing here blocks saving. A sheet mid-edit is routinely invalid (you pick
 * the spells before you raise the level that allows them), and refusing to
 * save would lose work over a state the player is on their way out of. These
 * are advice, and the schema author chose the wording.
 */
export default function ValidatorMessages({ results = [] }) {
  if (!results.length) return null

  const ordered = [...results].sort((a, b) => rank(a.severity) - rank(b.severity))

  return (
    <ul
      className="gc-validators"
      aria-label="Sheet warnings"
      style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'grid', gap: 6 }}
    >
      {ordered.map((result, index) => {
        const isError = result.severity === 'error'
        const Icon = isError ? LuCircleAlert : LuTriangleAlert
        return (
          <li
            key={`${result.rule}-${index}`}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${isError ? 'var(--danger)' : 'var(--warning)'}`,
              background: 'var(--bg-card)',
              color: 'var(--text-dim)',
              fontSize: 13,
            }}
          >
            <Icon
              size={15}
              style={{ flexShrink: 0, marginTop: 1 }}
              color={isError ? 'var(--danger)' : 'var(--warning)'}
            />
            {/* The live-region role goes on the message, not the <li>: putting
                it on the list item overrides its `listitem` role, which costs a
                screen-reader user the "3 of 4" position announcement. */}
            <span role={isError ? 'alert' : 'status'}>{result.message}</span>
          </li>
        )
      })}
    </ul>
  )
}

const rank = (severity) => (severity === 'error' ? 0 : 1)

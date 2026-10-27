import { useTranslation } from 'react-i18next'

/**
 * Per-member read/write access for a Private ("members") wiki page.
 *
 * A small table — one row per member, a Read and a Write checkbox right-aligned
 * under their headers — rather than a per-member dropdown: with two independent
 * bits the whole grid is readable at a glance, and comparing who can do what
 * down a column is the question an author actually asks.
 *
 * Write implies read, which the server enforces too. Rather than let the two
 * checkboxes express a state the backend would silently rewrite, ticking Write
 * checks Read and disables it — the constraint is visible in the control
 * instead of being a rule you have to know. Unticking Write releases Read again
 * (still ticked, now editable), so the way back out is where you'd expect it.
 *
 * `members` is the campaign's member list minus the page's author; the caller
 * decides who is eligible. `onChange(readIds, writeIds)` receives both full
 * lists, matching the API's two-array shape.
 */
export default function ShareAccessTable({ members, readIds, writeIds, onChange }) {
  const { t } = useTranslation()

  const setAccess = (userId, { read, write }) => {
    const reads = new Set(readIds)
    const writes = new Set(writeIds)
    // Write implies read, so granting write adds both and revoking read clears
    // write with it. Keeps the emitted pair valid no matter which box was hit.
    if (write) {
      reads.add(userId)
      writes.add(userId)
    } else if (read) {
      reads.add(userId)
      writes.delete(userId)
    } else {
      reads.delete(userId)
      writes.delete(userId)
    }
    onChange([...reads], [...writes])
  }

  if (!members.length) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('wiki.noMembers')}</div>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ ...headCell, textAlign: 'left' }}>{t('wiki.shareName')}</th>
          <th style={{ ...headCell, ...checkCol }}>{t('wiki.shareRead')}</th>
          <th style={{ ...headCell, ...checkCol }}>{t('wiki.shareWrite')}</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const name = m.character_name || m.display_name || m.username
          const canWrite = writeIds.includes(m.user_id)
          // Write implies read, so a writer's Read box is ticked and locked.
          const canRead = canWrite || readIds.includes(m.user_id)
          return (
            <tr key={m.user_id}>
              <td
                style={{
                  ...bodyCell,
                  maxWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={name}
              >
                {name}
              </td>
              <td style={{ ...bodyCell, ...checkCol }}>
                <input
                  type="checkbox"
                  checked={canRead}
                  disabled={canWrite}
                  onChange={(e) =>
                    setAccess(m.user_id, { read: e.target.checked, write: canWrite })
                  }
                  aria-label={t('wiki.shareReadFor', { name })}
                  // Spelled out for assistive tech, since a disabled box gives
                  // no clue as to why it can't be unticked.
                  title={canWrite ? t('wiki.shareReadLocked') : undefined}
                  style={{ cursor: canWrite ? 'not-allowed' : 'pointer' }}
                />
              </td>
              <td style={{ ...bodyCell, ...checkCol }}>
                <input
                  type="checkbox"
                  checked={canWrite}
                  onChange={(e) => setAccess(m.user_id, { read: canRead, write: e.target.checked })}
                  aria-label={t('wiki.shareWriteFor', { name })}
                  style={{ cursor: 'pointer' }}
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const headCell = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  padding: '0 4px 6px',
}

const bodyCell = {
  padding: '3px 4px',
  color: 'var(--text-dim)',
}

// The two checkbox columns are sized to their headers and right-aligned, so the
// boxes line up in a scannable pair however long the names get.
const checkCol = {
  width: 52,
  textAlign: 'right',
}

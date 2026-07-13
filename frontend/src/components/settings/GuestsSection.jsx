import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import GuestRow from './GuestRow'

// Admin view of the per-campaign guest accounts, with a convert-to-permanent
// action. Guests never appear in the main user list, so this is the only place
// an admin can see who a GM invited and to which campaign.
export default function GuestsSection({ passwordAuthEnabled, onConverted }) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState(null)
  const [error, setError] = useState('')
  const [convertingId, setConvertingId] = useState(null)
  const [open, setOpen] = useState(false)

  const load = () =>
    api
      .get('/users/guests')
      .then(setGuests)
      .catch(() => setGuests([]))

  // Lazy-load on first expand so the users tab isn't slowed by an extra request.
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && guests === null) load()
  }

  const handleConvert = (userId, updated) => {
    setGuests((prev) => prev.filter((g) => g.id !== userId))
    setConvertingId(null)
    onConverted?.(updated)
  }

  return (
    <div style={{ marginTop: 32 }}>
      <button
        onClick={toggle}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          fontSize: 15,
          fontWeight: 600,
          padding: 0,
          marginBottom: open ? 12 : 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {open ? '▾' : '▸'} {t('guests.guests')}
        {guests !== null && (
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 13 }}>
            ({guests.length})
          </span>
        )}
      </button>

      {open && (
        <>
          {error && (
            <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          {guests === null ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('common.loading')}</p>
          ) : guests.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('guests.none')}</p>
          ) : (
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                // Scroll within the card on narrow screens rather than clipping
                // columns or pushing the page sideways.
                overflowX: 'auto',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={headStyle}>{t('guests.name')}</th>
                    <th style={headStyle}>{t('guests.campaign')}</th>
                    <th style={headStyle}>{t('guests.invitedBy')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('guests.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g) => (
                    <GuestRow
                      key={g.id}
                      guest={g}
                      passwordAuthEnabled={passwordAuthEnabled}
                      converting={convertingId === g.id}
                      onStartConvert={() => setConvertingId(g.id)}
                      onCancelConvert={() => setConvertingId(null)}
                      onConverted={(updated) => handleConvert(g.id, updated)}
                      onError={setError}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const headStyle = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  background: 'var(--bg-deep)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

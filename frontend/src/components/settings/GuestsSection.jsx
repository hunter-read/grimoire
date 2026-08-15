import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import GuestRow from './GuestRow'

// Admin view of the per-campaign guest accounts, with convert, delete, and
// merge actions. Guests never appear in the main user list, so this is the only
// place an admin can see who a GM invited and to which campaign.
//
// Merge exists because one person invited to several campaigns gets a separate
// guest account per campaign; selecting them and merging collapses them into a
// single login that keeps every membership.
export default function GuestsSection({ passwordAuthEnabled, users, onConverted }) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState(null)
  const [error, setError] = useState('')
  const [convertingId, setConvertingId] = useState(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [merging, setMerging] = useState(false)

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
    setSelected((prev) => prev.filter((id) => id !== userId))
    setConvertingId(null)
    onConverted?.(updated)
  }

  const handleDeleted = (userId) => {
    setGuests((prev) => prev.filter((g) => g.id !== userId))
    setSelected((prev) => prev.filter((id) => id !== userId))
  }

  const toggleSelected = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))

  const submitMerge = async () => {
    // The target may be a permanent account that isn't in the selection at all,
    // in which case every selected guest is a source.
    const sources = selected.filter((id) => id !== mergeTarget)
    if (!mergeTarget || sources.length === 0) return
    setError('')
    setMerging(true)
    try {
      await api.post(`/users/${mergeTarget}/merge`, { source_ids: sources })
      setGuests((prev) => prev.filter((g) => !sources.includes(g.id)))
      setSelected([])
      setMergeTarget('')
    } catch (err) {
      setError(err?.body?.detail || err.message || t('guests.mergeFailed'))
    } finally {
      setMerging(false)
    }
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
            <>
              {/* One selected guest is enough: it can be merged into a
                  permanent account. Two or more can also be merged together. */}
              {selected.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    marginBottom: 12,
                    padding: '10px 14px',
                    background: 'var(--bg-deep)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    {t('guests.mergeInto', { count: selected.length })}
                  </span>
                  <select
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    aria-label={t('guests.mergeTarget')}
                    style={selectStyle}
                  >
                    <option value="">{t('guests.mergeTargetPlaceholder')}</option>
                    {selected.length > 1 && (
                      <optgroup label={t('guests.mergeTargetGuests')}>
                        {guests
                          .filter((g) => selected.includes(g.id))
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.display_name || g.id}
                              {g.campaign_name ? ` — ${g.campaign_name}` : ''}
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {/* Folding a guest into the real account the same person
                        already has is the other half of "connect them". */}
                    {users?.length > 0 && (
                      <optgroup label={t('guests.mergeTargetUsers')}>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.display_name || u.username}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    onClick={submitMerge}
                    disabled={!mergeTarget || merging}
                    style={{
                      ...mergeBtnStyle,
                      opacity: !mergeTarget || merging ? 0.5 : 1,
                      cursor: !mergeTarget || merging ? 'default' : 'pointer',
                    }}
                  >
                    {merging ? t('guests.merging') : t('guests.merge')}
                  </button>
                </div>
              )}

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
                      <th style={{ ...headStyle, width: 36 }} aria-label={t('guests.select')} />
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
                        selected={selected.includes(g.id)}
                        onToggleSelected={() => toggleSelected(g.id)}
                        onStartConvert={() => setConvertingId(g.id)}
                        onCancelConvert={() => setConvertingId(null)}
                        onConverted={(updated) => handleConvert(g.id, updated)}
                        onDeleted={() => handleDeleted(g.id)}
                        onError={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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

const selectStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const mergeBtnStyle = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
}

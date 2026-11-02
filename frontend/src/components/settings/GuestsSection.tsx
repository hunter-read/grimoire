import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import api, { type Schema } from '../../api'
import GuestRow from './GuestRow'
import { AnchorTargetContext, useSettingsTarget } from './settingsTarget'

type Guest = Schema<'backend__routers__users___schemas__GuestOut'>
type User = Schema<'UserOut'>

interface GuestsSectionProps {
  passwordAuthEnabled?: boolean
  /** Permanent accounts, offered as merge targets. */
  users?: User[] | null
  onConverted?: (user: User) => void
}

const STORAGE_KEY = 'grimoire:settings:people:guests'

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function storeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the list still opens, it just won't be
    // remembered next time.
  }
}

// Admin view of the per-campaign guest accounts, with convert, delete, and
// merge actions. Guests never appear in the main user list, so this is the only
// place an admin can see who a GM invited and to which campaign.
//
// Merge exists because one person invited to several campaigns gets a separate
// guest account per campaign; selecting them and merging collapses them into a
// single login that keeps every membership.
export default function GuestsSection({
  passwordAuthEnabled,
  users,
  onConverted,
}: GuestsSectionProps) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [error, setError] = useState('')
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [open, setOpen] = useState(readStoredOpen)
  const [selected, setSelected] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [merging, setMerging] = useState(false)
  const [status, setStatus] = useState('')
  // Where focus goes when the row that had it is deleted.
  const toggleRef = useRef<HTMLButtonElement>(null)
  const requested = useRef(false)
  const bodyId = `${useId()}-guests`
  const linkedHere = useContext(AnchorTargetContext)
  const { nonce } = useSettingsTarget()

  // Lazy-load on first open so the People page isn't slowed by an extra
  // request for a list most visits never look at.
  useEffect(() => {
    if (!open || requested.current) return
    requested.current = true
    api
      .get('/users/guests')
      .then(setGuests)
      .catch(() => setGuests([]))
  }, [open])

  // Arriving by a `#guests` link opens the list without changing what is
  // remembered for the next ordinary visit.
  useEffect(() => {
    if (linkedHere) setOpen(true)
  }, [linkedHere, nonce])

  const toggle = () => {
    const next = !open
    setOpen(next)
    storeOpen(next)
  }

  const handleConvert = (userId: string, updated: User) => {
    setStatus(
      t('a11y.settingsAccess.guestConverted', {
        name: updated?.username || updated?.display_name || '',
      })
    )
    setGuests((prev) => (prev ?? []).filter((g) => g.id !== userId))
    setSelected((prev) => prev.filter((id) => id !== userId))
    setConvertingId(null)
    onConverted?.(updated)
  }

  const handleDeleted = (userId: string) => {
    setStatus(t('a11y.settingsAccess.guestDeleted'))
    toggleRef.current?.focus()
    setGuests((prev) => (prev ?? []).filter((g) => g.id !== userId))
    setSelected((prev) => prev.filter((id) => id !== userId))
  }

  const toggleSelected = (id: string) =>
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
      setStatus(t('a11y.settingsAccess.guestsMerged', { count: sources.length }))
      setGuests((prev) => (prev ?? []).filter((g) => !sources.includes(g.id)))
      setSelected([])
      setMergeTarget('')
    } catch (err) {
      const e = err as { body?: { detail?: string }; message?: string } | null
      setError(e?.body?.detail || e?.message || t('guests.mergeFailed'))
    } finally {
      setMerging(false)
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>
        <button
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          style={disclosureStyle}
        >
          {open ? (
            <LuChevronDown size={16} aria-hidden="true" />
          ) : (
            <LuChevronRight size={16} aria-hidden="true" />
          )}
          <span>{t('guests.guests')}</span>
          {guests !== null && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({guests.length})</span>
          )}
        </button>
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: '70ch' }}>
        {t('settings.entries.guestsDesc')}
      </p>

      {/* Merges and conversions remove rows, so say what happened. */}
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {open && (
        <div id={bodyId} style={{ marginTop: 16 }}>
          {error && (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {guests === null ? (
            <p role="status" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {t('common.loading')}
            </p>
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
                    {users && users.length > 0 && (
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
        </div>
      )}
    </div>
  )
}

const disclosureStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: 0,
  background: 'none',
  border: 'none',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
}

const headStyle: CSSProperties = {
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

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-control)',
  color: 'var(--text)',
}

const mergeBtnStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
}

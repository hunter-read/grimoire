import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { campaigns as campaignsApi } from '../../../api'
import Spinner from '../../Spinner'

/**
 * Where a finished `.uvtt` goes: into a campaign, under a category.
 *
 * Two steps — pick the campaign, then pick the category — and deliberately not
 * the token editor's dialog. A map has no character route, which is half of
 * that component; and only campaigns the viewer *manages* can be offered here,
 * because the upload endpoint is guarded by `assert_can_manage`. Offering a
 * game they merely play in would be offering something the server refuses.
 *
 * A category named like "Maps" is preselected when the campaign has one, since
 * that is where a battlemap belongs and it saves the common case a click. None
 * is created if it does not exist: inventing categories in someone's campaign
 * is a change they did not ask for, and the default group is a fine home.
 */

// Matched case-insensitively across the languages the UI ships in, so a GM who
// named their category in their own language still gets the preselection.
const MAP_CATEGORY_PATTERN = /^(maps?|battlemaps?|karten?|mapas?|cartes?|kaarten|mapa|plans?)$/i

export const isMapCategory = (name) => MAP_CATEGORY_PATTERN.test((name || '').trim())

export default function SendVttToCampaignDialog({ userId, onClose, onChoose, busy }) {
  const { t } = useTranslation()
  const [owned, setOwned] = useState(null)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const [target, setTarget] = useState(null)
  const [categories, setCategories] = useState(null)

  useEffect(() => {
    let cancelled = false
    campaignsApi
      .list()
      .then((list) => {
        if (cancelled) return
        // `/campaigns` answers with a bare array, not a `{campaigns}` wrapper.
        const rows = Array.isArray(list) ? list : list?.campaigns || []
        // Mirror `assert_can_manage`: the owner, and not while archived. Only
        // these will accept an upload, and offering any other campaign would be
        // offering something the server refuses.
        setOwned(rows.filter((c) => c.owner_id === userId && !c.is_archived))
      })
      .catch((err) => {
        if (cancelled) return
        // The fallback message is resolved at render time instead of here, so
        // `t` stays out of the dependency list below.
        setError(err.message || '')
        setFailed(true)
        setOwned([])
      })
    return () => {
      cancelled = true
    }
    // Deliberately keyed on `userId` alone. `t` is *not* a dependency: i18next
    // hands back a new function identity on each render, so including it would
    // refetch the campaign list on a loop — which is why the failure message is
    // resolved at render time rather than stored here.
  }, [userId])

  // Categories are per-campaign, so they load only once one is chosen.
  // Keyed on the id rather than the campaign object: the object is an element
  // of a freshly-built array, so depending on it would re-run this effect for
  // every new identity and refetch the same categories on a loop.
  const targetId = target?.id
  useEffect(() => {
    if (!targetId) return undefined
    let cancelled = false
    setCategories(null)
    campaignsApi
      .listCategories(targetId, 'resource')
      .then((data) => {
        if (!cancelled) setCategories(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        // A campaign with no categories is the normal case, not an error: the
        // map then lands in the default group.
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [targetId])

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    // Step back before closing, so a user one level in does not lose the whole
    // dialog to one keystroke.
    e.stopPropagation()
    if (target) setTarget(null)
    else onClose()
  }

  const suggested = (categories || []).find((c) => isMapCategory(c.name))

  return (
    <div style={backdrop} onClick={onClose}>
      <div
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('maps.vtt.send.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          {target ? t('maps.vtt.send.chooseCategory') : t('maps.vtt.send.title')}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.5 }}>
          {target
            ? t('maps.vtt.send.chooseCategoryHint', { name: target.name })
            : t('maps.vtt.send.hint')}
        </p>

        {owned === null && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Spinner size={20} />
          </div>
        )}

        {failed && (
          <div style={{ color: 'var(--danger)', fontSize: 12 }}>
            {error || t('maps.vtt.send.failed')}
          </div>
        )}

        {owned !== null && owned.length === 0 && !failed && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('maps.vtt.send.noCampaigns')}</p>
        )}

        {target ? (
          <div style={listStyle}>
            {categories === null ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <Spinner size={20} />
              </div>
            ) : (
              <>
                {suggested && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onChoose({ campaignId: target.id, categoryId: suggested.id })}
                    style={{ ...rowStyle, borderColor: 'var(--gold)' }}
                  >
                    <div style={rowTitle}>{suggested.name}</div>
                    <div style={rowSub}>{t('maps.vtt.send.suggested')}</div>
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose({ campaignId: target.id, categoryId: null })}
                  style={rowStyle}
                >
                  <div style={rowTitle}>{t('maps.vtt.send.defaultCategory')}</div>
                  <div style={rowSub}>{t('maps.vtt.send.defaultCategoryHint')}</div>
                </button>
                {(categories || [])
                  .filter((c) => c.id !== suggested?.id)
                  .map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onChoose({ campaignId: target.id, categoryId: category.id })}
                      style={rowStyle}
                    >
                      <div style={rowTitle}>{category.name}</div>
                    </button>
                  ))}
              </>
            )}
          </div>
        ) : (
          owned !== null &&
          owned.length > 0 && (
            <div style={listStyle}>
              {owned.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => setTarget(campaign)}
                  style={rowStyle}
                >
                  <div style={rowTitle}>{campaign.name}</div>
                </button>
              ))}
            </div>
          )
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          {busy && <Spinner size={16} />}
          {target && (
            <button type="button" onClick={() => setTarget(null)} style={btn} disabled={busy}>
              {t('common.back')}
            </button>
          )}
          <button type="button" onClick={onClose} style={btn} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

const listStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 320,
  overflowY: 'auto',
}

const rowStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const rowTitle = { fontSize: 13, fontWeight: 600 }
const rowSub = { fontSize: 11, color: 'var(--text-dim)' }

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 20,
}

const panel = {
  width: '100%',
  maxWidth: 420,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
}

const btn = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}

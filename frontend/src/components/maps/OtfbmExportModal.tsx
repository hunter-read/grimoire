import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuDownload, LuCopy, LuCircleCheck, LuLink } from 'react-icons/lu'
import api, { mediaUrl, shareLinks } from '../../api'
import type { Schema } from '../../api'
import { otfbmCommand } from './otfbm'
import { EXPIRY_OPTIONS, formatWhen, publicUrl } from '../share/shareLinkUtils'

// Until the server has answered, the cell-size field still needs bounds to
// validate against; these are OTFBM's own, which the plan echoes back.
const FALLBACK_MIN = 20
const FALLBACK_MAX = 100

/** The working OTFBM share link for this cell size, if there is one. */
type OtfbmPlan = Schema<'OtfbmPlanResponse'>
type ShareLink = Schema<'ShareLinkOut'>

export interface OtfbmExportModalProps {
  mapId: string
  filename: string
  onClose: () => void
}

const linkForCell = (links: ShareLink[], cell: number) =>
  links.find(
    (l) =>
      l.state === 'active' &&
      !l.has_password &&
      l.variant === 'otfbm' &&
      l.variant_options?.cell === cell
  ) || null

/**
 * Sets a map up as an OTFBM background for Avrae's `!map` (issue #551).
 *
 * OTFBM draws the background at its native size under a grid of `c` pixels per
 * cell, so the map is resized until each of its cells is exactly `c` pixels.
 * OTFBM fetches the background from a URL, so the resized image is served
 * through a share link (variant "otfbm") and the command comes out complete.
 * An existing link at the same cell size is reused rather than duplicated.
 * Downloading the image to host elsewhere stays available as a fallback.
 */
export default function OtfbmExportModal({ mapId, filename, onClose }: OtfbmExportModalProps) {
  const { t, i18n } = useTranslation()
  const [plan, setPlan] = useState<OtfbmPlan | null>(null)
  const [error, setError] = useState(false)
  const [cellInput, setCellInput] = useState('')
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [expiry, setExpiry] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // First ask without a cell size, so the server's suggestion seeds the field;
  // and fetch the OTFBM links already made for this map, to reuse one.
  useEffect(() => {
    let live = true
    api
      .get(`/maps/${mapId}/otfbm`)
      .then((res) => {
        if (!live) return
        const p = res as OtfbmPlan
        setPlan(p)
        setCellInput(String(p.cell))
      })
      .catch(() => live && setError(true))
    shareLinks
      .list({ resource_type: 'map', resource_id: mapId, variant: 'otfbm' })
      .then((data) => live && setLinks(data))
      .catch(() => live && setLinks([]))
    return () => {
      live = false
    }
  }, [mapId])

  const min = plan?.min_cell ?? FALLBACK_MIN
  const max = plan?.max_cell ?? FALLBACK_MAX
  const cell = /^\d+$/.test(cellInput) ? Number(cellInput) : NaN
  const cellValid = cell >= min && cell <= max
  // The plan lags the field by the debounce; nothing acts on a half-typed value.
  const settled = Boolean(plan) && cellValid && cell === plan!.cell

  // Re-plan as the cell size changes. Debounced so typing "75" does not ask
  // about a 7px cell on the way; the server owns the arithmetic, so the sizes
  // shown are always the ones the link will serve.
  useEffect(() => {
    if (!plan || !cellValid || cell === plan.cell) return
    const timer = setTimeout(() => {
      api
        .get(`/maps/${mapId}/otfbm?cell=${cell}`)
        .then((p) => setPlan(p as OtfbmPlan))
        .catch(() => setError(true))
    }, 250)
    return () => clearTimeout(timer)
  }, [cell, cellValid, plan, mapId])

  const link = settled && links ? linkForCell(links, plan!.cell) : null
  const command = link ? otfbmCommand(plan, publicUrl(link.file_url as string)) : ''

  const createLink = async () => {
    setCreating(true)
    setCreateError('')
    try {
      const created = await shareLinks.create({
        resource_type: 'map',
        resource_id: mapId,
        variant: 'otfbm',
        cell: plan!.cell,
        label: t('maps.otfbm.linkLabel', { cell: plan!.cell }),
        expires_in_days: expiry ? Number(expiry) : null,
      })
      setLinks((prev) => [created, ...(prev || [])])
    } catch (err) {
      setCreateError((err as Error).message || t('share.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be unavailable (insecure origin); the command is selectable.
    }
  }

  const label: CSSProperties = { fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }
  const hint: CSSProperties = {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 6,
    lineHeight: 1.5,
  }
  const warn: CSSProperties = { ...hint, color: 'var(--gold)' }
  const input: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 10px',
    fontSize: 14,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text)',
  }
  const button = (primary: boolean): CSSProperties => ({
    background: primary ? 'var(--gold-dim)' : 'var(--bg-card)',
    border: `1px solid ${primary ? 'var(--gold-dim)' : 'var(--border)'}`,
    color: primary ? 'var(--bg-deep)' : 'var(--text)',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 13,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    textDecoration: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="otfbm-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 480,
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span id="otfbm-modal-title" style={{ fontSize: 15, fontWeight: 600 }}>
            {t('maps.otfbm.title')}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
            aria-label={t('common.close')}
          >
            <LuX size={16} />
          </button>
        </div>
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            marginBottom: 12,
            overflowWrap: 'anywhere',
          }}
        >
          {filename}
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>{t('maps.otfbm.intro')}</p>

        {error ? (
          <p role="alert" style={warn}>
            {t('maps.otfbm.loadFailed')}
          </p>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="otfbm-cell" style={label}>
                {t('maps.otfbm.cellSize')}
              </label>
              <input
                id="otfbm-cell"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={cellInput}
                disabled={!plan}
                aria-invalid={plan && !cellValid ? 'true' : undefined}
                onChange={(e) => setCellInput(e.target.value)}
                style={{ ...input, width: 96 }}
              />
              {plan && (
                <>
                  <p style={hint}>
                    {t('maps.otfbm.cellHint', { min, max, suggested: plan.suggested_cell })}
                  </p>
                  <p style={hint} data-testid="otfbm-summary">
                    {t('maps.otfbm.summary', {
                      width: plan.width,
                      height: plan.height,
                      imageWidth: plan.image_width,
                      imageHeight: plan.image_height,
                    })}
                  </p>
                  {plan.grid_source === 'default' && (
                    <p style={warn}>{t('maps.otfbm.defaultGrid')}</p>
                  )}
                  {plan.truncated && <p style={warn}>{t('maps.otfbm.truncated')}</p>}
                </>
              )}
              {plan && !cellValid && (
                <p role="alert" style={warn}>
                  {t('maps.otfbm.cellInvalid', { min, max })}
                </p>
              )}
            </div>

            {settled && links !== null && !link && (
              <div style={{ marginBottom: 20 }}>
                <div style={label}>{t('maps.otfbm.linkTitle')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Labelled in words, not just by position: a bare "Never"
                      next to "Create share link" did not read as an expiry. */}
                  <label htmlFor="otfbm-expiry" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    {t('share.form.expiry')}
                  </label>
                  <select
                    id="otfbm-expiry"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    style={{ ...input, width: 'auto' }}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.key} value={o.value}>
                        {t(`share.expiry.${o.key}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={createLink}
                    disabled={creating}
                    style={{ ...button(true), opacity: creating ? 0.6 : 1 }}
                  >
                    <LuLink size={13} aria-hidden="true" /> {t('maps.otfbm.createLink')}
                  </button>
                </div>
                <p style={hint}>{t('maps.otfbm.linkHint')}</p>
                {createError && (
                  <p role="alert" style={warn}>
                    {createError}
                  </p>
                )}
              </div>
            )}

            {link && (
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="otfbm-command" style={label}>
                  {t('maps.otfbm.command')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="otfbm-command"
                    readOnly
                    value={command}
                    onFocus={(e) => e.target.select()}
                    style={{
                      ...input,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 13,
                    }}
                  />
                  <button type="button" onClick={copy} style={button(false)}>
                    {copied ? <LuCircleCheck size={13} /> : <LuCopy size={13} />}
                    {copied ? t('maps.otfbm.copied') : t('maps.otfbm.copy')}
                  </button>
                </div>
                <p style={hint} data-testid="otfbm-link-status">
                  {link.expires_at
                    ? t('maps.otfbm.linkUntil', {
                        when: formatWhen(link.expires_at, i18n.language),
                      })
                    : t('maps.otfbm.linkForever')}
                </p>
              </div>
            )}

            {settled && (
              <p style={{ ...hint, marginTop: 0 }}>
                {t('maps.otfbm.selfHost')}{' '}
                <a
                  href={mediaUrl(`/maps/${mapId}/otfbm/image`, { cell: plan!.cell })}
                  download
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <LuDownload size={12} aria-hidden="true" />
                  {t('maps.otfbm.download')}
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

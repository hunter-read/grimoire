import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCombine, LuLayers } from 'react-icons/lu'

import { duplicates as dupesApi, type DuplicateType } from '../../api'
import useDialogFocus from '../../hooks/useDialogFocus'
import { formatSize } from '../../utils'
import Spinner from '../Spinner'
import MergeSummary, { type MergeResult } from './MergeSummary'

type MergeItem = MergeResult['items'] extends (infer I)[] | undefined ? I : never

export interface MergeOutcome {
  action: 'merged' | 'linked'
  keepId: string
  /** The copies that no longer stand on their own: merged away, or filed as versions. */
  removedIds: string[]
}

interface Props {
  resourceType: DuplicateType
  /** Every copy involved, two or more. */
  ids: string[]
  /** Pre-chosen keeper; left out, the server's suggestion is used. */
  keepId?: string
  onClose: () => void
  onDone: (outcome: MergeOutcome) => void
}

/**
 * Confirm merging copies into one (issue #589), from a multi-selection or a
 * row of the duplicates list.
 *
 * Opens on the suggested keeper with the dry run's summary, so the user sees
 * exactly what will move before anything does. Choosing another keeper or
 * ticking "delete the other files" re-runs the dry run. "Link as versions" is
 * the other way out, for copies that turn out to be different editions rather
 * than the same file twice.
 */
export default function MergeDialog({ resourceType, ids, keepId, onClose, onDone }: Props) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [keeper, setKeeper] = useState<string | null>(keepId || null)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [report, setReport] = useState<MergeResult | null>(null)
  // Every copy's details, from the first dry run. Later runs describe the same
  // records, so the list holds still while only the summary changes.
  const [items, setItems] = useState<MergeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The dry run already answered for this keeper: the first response names the
  // keeper the server picked, and adopting it must not trigger an identical run.
  const answered = useRef('')

  const close = () => {
    if (!busy) onClose()
  }
  useDialogFocus(dialogRef, { onClose: close })

  useEffect(() => {
    const key = `${keeper}|${deleteFiles}`
    if (answered.current === key) return
    let cancelled = false
    setLoading(true)
    dupesApi
      .merge({
        resource_type: resourceType,
        ...(keeper ? { keep_id: keeper } : {}),
        merge_ids: keeper ? ids.filter((id) => id !== keeper) : ids,
        delete_files: deleteFiles,
        dry_run: true,
      })
      .then((res) => {
        if (cancelled) return
        answered.current = `${res.keep_id}|${deleteFiles}`
        setReport(res)
        setItems((prev) => {
          if (prev.length) return prev
          const byId = new Map((res.items || []).map((i) => [i.id, i]))
          return ids.map((id) => byId.get(id)).filter((i): i is MergeItem => !!i)
        })
        setKeeper(res.keep_id)
        setError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || t('maintenance.dupes.actionFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `ids` and `t` are fixed for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keeper, deleteFiles])

  const others = ids.filter((id) => id !== keeper)

  const run = async (fn: () => Promise<MergeOutcome>) => {
    setBusy(true)
    try {
      onDone(await fn())
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.actionFailed'))
      setBusy(false)
    }
  }

  const merge = () =>
    run(async () => {
      await dupesApi.merge({
        resource_type: resourceType,
        keep_id: keeper as string,
        merge_ids: others,
        delete_files: deleteFiles,
      })
      return { action: 'merged', keepId: keeper as string, removedIds: others }
    })

  const link = () =>
    run(async () => {
      const res = await dupesApi.link(
        resourceType,
        keeper as string,
        others.map((id) => ({ id, kind: 'version', label: '' }))
      )
      if (res.errors?.length) {
        // Partial links stand; say which copies could not be filed.
        throw new Error(res.errors.map((e) => e.detail).join(' '))
      }
      return { action: 'linked', keepId: keeper as string, removedIds: res.linked }
    })

  const ready = !!report && !!keeper && !loading && !busy

  return (
    <div
      style={backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
      >
        <h3 id="merge-dialog-title" style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px' }}>
          {t('merge.title', { count: ids.length })}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('merge.chooseKeeper')}
        </p>

        {items.length === 0 && loading && <Spinner size={18} />}

        <div role="radiogroup" aria-label={t('merge.keeperLabel')} style={{ marginBottom: 14 }}>
          {items.map((item) => {
            const selected = item.id === keeper
            return (
              <label
                key={item.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '9px 11px',
                  marginBottom: 6,
                  borderRadius: 8,
                  cursor: busy ? 'default' : 'pointer',
                  border: `1px solid ${selected ? 'var(--variant)' : 'var(--border)'}`,
                  background: selected ? 'rgba(79,209,197,0.06)' : 'var(--bg-card)',
                }}
              >
                <input
                  type="radio"
                  name="merge-keeper"
                  checked={selected}
                  disabled={busy}
                  onChange={() => setKeeper(item.id)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 14, wordBreak: 'break-word' }}>
                    {item.title || item.filename}
                  </span>
                  {item.id === report?.suggested_keep_id && (
                    <span style={badge}>{t('merge.suggested')}</span>
                  )}
                  {item.is_missing && (
                    <span style={{ ...badge, color: 'var(--danger)' }}>
                      {t('merge.missingFile')}
                    </span>
                  )}
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.relative_path}
                    {' · '}
                    {formatSize(item.file_size || 0)}
                    {item.page_count ? ` · ${t('bookRow.pages', { count: item.page_count })}` : ''}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={deleteFiles}
            disabled={busy}
            onChange={(e) => setDeleteFiles(e.target.checked)}
          />
          {t('merge.deleteFiles')}
        </label>

        <div
          aria-live="polite"
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            minHeight: 40,
            opacity: loading ? 0.5 : 1,
          }}
        >
          {report && <MergeSummary results={[report]} />}
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            marginTop: 16,
          }}
        >
          <button type="button" onClick={close} disabled={busy} style={secondaryBtn}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={link}
            disabled={!ready}
            title={t('merge.linkHint')}
            style={{ ...secondaryBtn, opacity: ready ? 1 : 0.6 }}
          >
            <LuLayers size={13} aria-hidden="true" /> {t('merge.linkAsVersions')}
          </button>
          <button
            type="button"
            onClick={merge}
            disabled={!ready}
            style={{ ...primaryBtn, opacity: ready ? 1 : 0.6 }}
          >
            {busy ? <Spinner size={13} /> : <LuCombine size={13} aria-hidden="true" />}{' '}
            {t('merge.confirm', { count: others.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop = {
  position: 'fixed' as const,
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(560px, 100%)',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto' as const,
  boxSizing: 'border-box' as const,
}

const badge = {
  marginLeft: 8,
  fontSize: 11,
  padding: '1px 7px',
  borderRadius: 8,
  color: 'var(--variant)',
  border: '1px solid rgba(79,209,197,0.35)',
  whiteSpace: 'nowrap' as const,
}

const secondaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 14px',
  cursor: 'pointer',
  fontSize: 13,
}

const primaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  cursor: 'pointer',
  fontSize: 13,
}

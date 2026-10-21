import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCombine } from 'react-icons/lu'

import { duplicates as dupesApi, type Schema } from '../../api'
import useDialogFocus from '../../hooks/useDialogFocus'
import { groupMerge, type DuplicateGroup } from '../../utils/duplicateGroups'
import Spinner from '../Spinner'
import MergeSummary from './MergeSummary'

type BatchResult = Schema<'MergeBatchResult'>

// The batch endpoint's cap.
const MAX_BATCH = 200

interface Props {
  /** Groups whose copies are byte-identical. */
  groups: DuplicateGroup[]
  onClose: () => void
  /** After the merge ran, with how many groups merged and how many did not. */
  onDone: (outcome: { merged: number; failed: number }) => void
}

/**
 * "Merge all exact matches" (issue #589): every byte-identical group into its
 * suggested keeper, behind one confirmation.
 *
 * Identical files are the one case that needs no judgement about *which* copy
 * - they are the same bytes - so the only question left is the one the summary
 * answers: what moves, and whether the other files leave the disk. The summary
 * is the batch's dry run, summed across every group.
 */
export default function MergeExactDialog({ groups, onClose, onDone }: Props) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [preview, setPreview] = useState<BatchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const merges = groups.slice(0, MAX_BATCH).map(groupMerge)

  const close = () => {
    if (!busy) onClose()
  }
  useDialogFocus(dialogRef, { onClose: close })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    dupesApi
      .mergeBatch({ merges, delete_files: deleteFiles, dry_run: true })
      .then((res) => {
        if (!cancelled) setPreview(res)
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
    // The groups are fixed for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFiles])

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await dupesApi.mergeBatch({ merges, delete_files: deleteFiles })
      onDone({ merged: res.merged || 0, failed: res.failed || 0 })
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.actionFailed'))
      setBusy(false)
    }
  }

  const results = (preview?.results || []).flatMap((r) => (r.ok && r.result ? [r.result] : []))
  const failures = (preview?.results || []).filter((r) => !r.ok)
  const copies = merges.reduce((n, m) => n + m.merge_ids.length, 0)
  const ready = !!preview && results.length > 0 && !loading && !busy

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
        aria-labelledby="merge-exact-title"
      >
        <h3 id="merge-exact-title" style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px' }}>
          {t('maintenance.dupes.mergeExact.title', { count: merges.length })}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
          {t('maintenance.dupes.mergeExact.explainer', { count: copies })}
        </p>

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
          {!preview && loading && <Spinner size={18} />}
          {results.length > 0 && <MergeSummary results={results} />}
          {failures.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--gold)', marginTop: 8 }}>
              {t('maintenance.dupes.mergeExact.skipped', { count: failures.length })}
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {failures.map((f, i) => (
                  <li key={`${f.keep_id}-${i}`}>{f.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={close} disabled={busy} style={secondaryBtn}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready}
            style={{ ...primaryBtn, opacity: ready ? 1 : 0.6 }}
          >
            {busy ? <Spinner size={13} /> : <LuCombine size={13} aria-hidden="true" />}{' '}
            {t('maintenance.dupes.mergeExact.confirm', { count: results.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
}

const panel: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(520px, 100%)',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
}

const secondaryBtn: CSSProperties = {
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

const primaryBtn: CSSProperties = {
  ...secondaryBtn,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: 'none',
}

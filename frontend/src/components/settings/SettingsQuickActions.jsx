import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuFolderTree, LuRefreshCw, LuSquare } from 'react-icons/lu'
import Spinner from '../Spinner'
import RescanModal from '../RescanModal'
import useScanStatus from '../../hooks/useScanStatus'
import scanPhaseLabel from './scanPhaseLabel'

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  fontSize: 13,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  cursor: 'pointer',
}

/**
 * The admin's two most-reached-for settings, pinned to the top-right of every
 * settings tab: a whole-library rescan and the file manager. Both also live on
 * the Maintenance tab, but that is several clicks and a scroll away from
 * wherever the admin happens to be.
 *
 * The rescan behaves like the Maintenance one - mode picker first, then the
 * live phase in place of the label, with a stop control beside it.
 */
export default function SettingsQuickActions() {
  const { t } = useTranslation()
  const { status, stopping, startRescan, stopScan } = useScanStatus()
  const [showModal, setShowModal] = useState(false)
  const { running } = status

  const handleConfirm = (metadata_mode) => {
    startRescan({ scope: null, metadata_mode }).catch(() => {})
  }

  const stopLabel = stopping ? t('maintenance.rescan.stopping') : t('maintenance.rescan.stop')

  return (
    <div
      role="group"
      aria-label={t('settings.quickActions.label')}
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {/* Rescan and its stop control read as one joined control while a scan
          runs: the stop segment attaches to the right of the live status. */}
      <div style={{ display: 'inline-flex' }}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={running}
          title={t('maintenance.rescan.button')}
          style={{
            ...buttonStyle,
            color: running ? 'var(--gold)' : 'var(--text-dim)',
            cursor: running ? 'default' : 'pointer',
            ...(running && { borderTopRightRadius: 0, borderBottomRightRadius: 0 }),
          }}
        >
          {running ? <Spinner size={13} /> : <LuRefreshCw size={14} aria-hidden="true" />}
          {running ? scanPhaseLabel(t, status) : t('settings.quickActions.rescan')}
        </button>
        {running && (
          <button
            type="button"
            onClick={stopScan}
            disabled={stopping}
            title={stopLabel}
            aria-label={stopLabel}
            style={{
              ...buttonStyle,
              padding: '6px 9px',
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderLeft: 'none',
              background: 'rgba(180,60,60,0.12)',
              color: stopping ? 'var(--text-muted)' : 'var(--danger)',
              cursor: stopping ? 'default' : 'pointer',
            }}
          >
            <LuSquare size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <Link to="/settings/files" style={buttonStyle}>
        <LuFolderTree size={14} aria-hidden="true" />
        {t('settings.quickActions.fileManager')}
      </Link>

      {showModal && (
        <RescanModal scope={null} onConfirm={handleConfirm} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}

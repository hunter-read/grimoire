import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuRefreshCw, LuSquare } from 'react-icons/lu'
import Spinner from '../Spinner'
import RescanModal from '../RescanModal'
import useScanStatus from '../../hooks/useScanStatus'

export default function RescanSection() {
  const { t } = useTranslation()
  const { status, lastResult, stopping, startRescan, stopScan } = useScanStatus()
  const [showModal, setShowModal] = useState(false)

  const handleConfirm = (metadata_mode) => {
    startRescan({ scope: null, metadata_mode }).catch(() => {})
  }

  const {
    running,
    phase,
    indexed,
    to_index,
    total_books,
    scanned_books,
    total_maps,
    scanned_maps,
    total_tokens,
    scanned_tokens,
    total_audio,
    scanned_audio,
    total_ocr,
    ocr_done,
    ocr_current,
  } = status

  const totalScan = total_books + total_maps + total_tokens + total_audio
  const scannedScan = scanned_books + scanned_maps + scanned_tokens + scanned_audio
  const scanPct = totalScan > 0 ? Math.round((scannedScan / totalScan) * 100) : null
  const indexPct = to_index > 0 ? Math.round((indexed / to_index) * 100) : 0
  const ocrPct = total_ocr > 0 ? Math.round((ocr_done / total_ocr) * 100) : 0

  const phaseLabel =
    phase === 'scanning'
      ? scanPct !== null
        ? t('maintenance.rescan.scanningPercent', { pct: scanPct })
        : t('maintenance.rescan.scanning')
      : phase === 'indexing'
        ? t('maintenance.rescan.indexing', { indexed, total: to_index })
        : phase === 'ocr'
          ? t('maintenance.rescan.ocr', { done: ocr_done, total: total_ocr })
          : t('maintenance.rescan.scanning')

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.rescan.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.rescan.description')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => !running && setShowModal(true)}
          disabled={running}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: running ? 'var(--gold)' : 'var(--text-dim)',
            cursor: running ? 'default' : 'pointer',
          }}
        >
          {running ? <Spinner size={13} /> : <LuRefreshCw size={13} />}
          {running ? phaseLabel : t('maintenance.rescan.button')}
        </button>
        {running && (
          <button
            onClick={stopScan}
            disabled={stopping}
            title={t('maintenance.rescan.stop')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'rgba(180,60,60,0.12)',
              border: '1px solid rgba(180,60,60,0.35)',
              color: stopping ? 'var(--text-muted)' : 'var(--danger)',
              cursor: stopping ? 'default' : 'pointer',
            }}
          >
            <LuSquare size={13} />
            {stopping ? t('maintenance.rescan.stopping') : t('maintenance.rescan.stop')}
          </button>
        )}
      </div>

      {/* Progress bar — scanning phase */}
      {running && phase === 'scanning' && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div
            style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
          >
            {scanPct !== null ? (
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--gold)',
                  width: `${scanPct}%`,
                  transition: 'width 0.4s ease',
                }}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--gold)',
                  width: '40%',
                  animation: 'grimoire-scan-slide 1.4s ease-in-out infinite',
                }}
              />
            )}
          </div>
          {scanPct !== null && (
            <div
              style={{
                marginTop: 5,
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                {t('maintenance.rescan.scanProgress', {
                  pct: scanPct,
                  scanned: scannedScan,
                  total: totalScan,
                })}
              </span>
              <span>
                {t('maintenance.rescan.booksProgress', {
                  scanned: scanned_books,
                  total: total_books,
                })}
              </span>
              <span>
                {t('maintenance.rescan.mapsProgress', { scanned: scanned_maps, total: total_maps })}
              </span>
              <span>
                {t('maintenance.rescan.tokensProgress', {
                  scanned: scanned_tokens,
                  total: total_tokens,
                })}
              </span>
              <span>
                {t('maintenance.rescan.audioProgress', {
                  scanned: scanned_audio,
                  total: total_audio,
                })}
              </span>
            </div>
          )}
          <style>{`
            @keyframes grimoire-scan-slide {
              0%   { margin-left: -40%; }
              100% { margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* Progress bar — PDF indexing phase */}
      {running && phase === 'indexing' && to_index > 0 && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div
            style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                background: 'var(--gold)',
                width: `${indexPct}%`,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('maintenance.rescan.indexProgress', { pct: indexPct, indexed, total: to_index })}
          </div>
        </div>
      )}

      {/* Progress bar — deferred OCR phase */}
      {running && phase === 'ocr' && total_ocr > 0 && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div
            style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                background: 'var(--gold)',
                width: `${ocrPct}%`,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('maintenance.rescan.ocrProgress', {
              pct: ocrPct,
              done: ocr_done,
              total: total_ocr,
            })}
          </div>
          {ocr_current && (
            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={ocr_current}
            >
              {t('maintenance.rescan.ocrCurrent', { name: ocr_current })}
            </div>
          )}
        </div>
      )}

      {/* Completion summary */}
      {lastResult && !running && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <LuCircleCheck size={16} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
              {t('maintenance.rescan.complete')}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              {lastResult.new_books > 0 && (
                <span>{t('maintenance.rescan.books', { count: lastResult.new_books })}</span>
              )}
              {lastResult.new_maps > 0 && (
                <span>{t('maintenance.rescan.maps', { count: lastResult.new_maps })}</span>
              )}
              {lastResult.new_tokens > 0 && (
                <span>{t('maintenance.rescan.tokens', { count: lastResult.new_tokens })}</span>
              )}
              {lastResult.new_audio > 0 && (
                <span>{t('maintenance.rescan.audio', { count: lastResult.new_audio })}</span>
              )}
              {lastResult.indexed > 0 && (
                <span>{t('maintenance.rescan.indexed', { count: lastResult.indexed })}</span>
              )}
              {lastResult.updated_books > 0 && (
                <span>{t('maintenance.rescan.updated', { count: lastResult.updated_books })}</span>
              )}
              {lastResult.new_books +
                lastResult.new_maps +
                lastResult.new_tokens +
                (lastResult.new_audio || 0) +
                lastResult.indexed +
                (lastResult.updated_books || 0) ===
                0 && <span>{t('maintenance.rescan.noNewFiles')}</span>}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <RescanModal scope={null} onConfirm={handleConfirm} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import Spinner from '../Spinner'

export default function ExportTagsSection() {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [includeLibrary, setIncludeLibrary] = useState(true)
  const [includeMaps, setIncludeMaps] = useState(true)
  const [includeTokens, setIncludeTokens] = useState(true)
  const [includeAudio, setIncludeAudio] = useState(true)

  const handleExport = () => {
    setExporting(true)
    const params = {
      include_library: includeLibrary,
      include_maps: includeMaps,
      include_tokens: includeTokens,
      include_audio: includeAudio,
    }
    const url = mediaUrl('/export/tags', params)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => setExporting(false), 800)
  }

  const noneSelected = !includeLibrary && !includeMaps && !includeTokens && !includeAudio

  const checkboxStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    color: 'var(--text-dim)',
    cursor: 'pointer',
    userSelect: 'none',
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.tagExport.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.tagExport.description')}
      </p>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        <label htmlFor="export-tags-library" style={checkboxStyle}>
          <input
            id="export-tags-library"
            type="checkbox"
            checked={includeLibrary}
            onChange={(e) => setIncludeLibrary(e.target.checked)}
          />
          {t('maintenance.tagExport.library')}
        </label>
        <label htmlFor="export-tags-maps" style={checkboxStyle}>
          <input
            id="export-tags-maps"
            type="checkbox"
            checked={includeMaps}
            onChange={(e) => setIncludeMaps(e.target.checked)}
          />
          {t('maintenance.tagExport.maps')}
        </label>
        <label htmlFor="export-tags-tokens" style={checkboxStyle}>
          <input
            id="export-tags-tokens"
            type="checkbox"
            checked={includeTokens}
            onChange={(e) => setIncludeTokens(e.target.checked)}
          />
          {t('maintenance.tagExport.tokens')}
        </label>
        <label htmlFor="export-tags-audio" style={checkboxStyle}>
          <input
            id="export-tags-audio"
            type="checkbox"
            checked={includeAudio}
            onChange={(e) => setIncludeAudio(e.target.checked)}
          />
          {t('maintenance.tagExport.audio')}
        </label>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting || noneSelected}
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
          color: exporting ? 'var(--gold)' : 'var(--text-dim)',
          cursor: exporting || noneSelected ? 'default' : 'pointer',
          opacity: noneSelected ? 0.5 : 1,
        }}
      >
        {exporting ? <Spinner size={13} /> : <LuDownload size={13} />}
        {exporting ? t('maintenance.tagExport.exporting') : t('maintenance.tagExport.button')}
      </button>
    </div>
  )
}

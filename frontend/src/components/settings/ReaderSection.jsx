import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { getUserPrefs, saveUserPref, getWheelAction } from '../../hooks/useUserPrefs'
import SegmentedControl from './SegmentedControl'

export default function ReaderSection() {
  const { t } = useTranslation()
  const prefs = getUserPrefs()
  const [readerMode, setReaderMode] = useState(prefs.readerMode || 'default')
  // Reads the legacy wheelNav boolean too, so an existing "off" setting still
  // means "don't page on scroll" (issue #249).
  const [wheelAction, setWheelAction] = useState(() => getWheelAction(prefs))
  const [saved, setSaved] = useState(false)

  const READER_MODE_OPTIONS = [
    { value: 'default', label: t('userSettings.reader.perBook') },
    { value: 'page', label: t('userSettings.reader.page') },
    { value: 'spread', label: t('userSettings.reader.spread') },
    { value: 'pdf', label: t('userSettings.reader.pdf') },
  ]

  const WHEEL_ACTION_OPTIONS = [
    { value: 'page', label: t('userSettings.reader.wheelPage') },
    { value: 'zoom', label: t('userSettings.reader.wheelZoom') },
    { value: 'none', label: t('userSettings.reader.wheelNone') },
  ]

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const handleMode = (v) => {
    setReaderMode(v)
    saveUserPref('readerMode', v)
    flash()
  }
  const handleWheel = (v) => {
    setWheelAction(v)
    saveUserPref('wheelAction', v)
    flash()
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.reader.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('userSettings.reader.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('userSettings.reader.defaultViewMode')}
          </div>
          <SegmentedControl
            options={READER_MODE_OPTIONS}
            value={readerMode}
            onChange={handleMode}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('userSettings.reader.viewModeHint')}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('userSettings.reader.scrollWheel')}
          </div>
          <SegmentedControl
            options={WHEEL_ACTION_OPTIONS}
            value={wheelAction}
            onChange={handleWheel}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('userSettings.reader.scrollWheelHint')}
          </div>
        </div>
      </div>
    </div>
  )
}

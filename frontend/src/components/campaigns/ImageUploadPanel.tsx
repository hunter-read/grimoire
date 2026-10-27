import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUpload } from 'react-icons/lu'
import { campaigns } from '../../api'
import { miniBtn, miniBtnGhost } from './embedPickerStyles'

const radioRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}
const selectStyle = {
  appearance: 'auto',
  fontSize: 13,
  padding: '6px 8px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
}

// Upload an image, choosing an existing resource category or creating a new one.
export default function ImageUploadPanel({ campaignId, onUploaded, onCancel }) {
  const { t } = useTranslation()
  const [categories, setCategories] = useState([])
  const [mode, setMode] = useState('existing') // 'existing' | 'new'
  const [categoryId, setCategoryId] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    campaigns
      .listCategories(campaignId, 'resource')
      .then((list) => {
        setCategories(list || [])
        // Default to "new category" when the campaign has none yet.
        if (!list || list.length === 0) setMode('new')
      })
      .catch(() => setCategories([]))
  }, [campaignId])

  const submit = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError(t('wiki.chooseImage'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const opts =
        mode === 'new' ? { newCategoryName: newName.trim() } : categoryId ? { categoryId } : {}
      const created = await campaigns.uploadImage(campaignId, file, opts)
      onUploaded(created)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={t('wiki.chooseImage')}
        style={{ fontSize: 13, color: 'var(--text-dim)' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {t('wiki.imageCategory')}
        </div>
        <label style={radioRow}>
          <input
            type="radio"
            name="catmode"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
            disabled={categories.length === 0}
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={mode !== 'existing' || categories.length === 0}
            aria-label={t('resources.categoryLabel')}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="">{t('resources.typeGroup')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label style={radioRow}>
          <input
            type="radio"
            name="catmode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onFocus={() => setMode('new')}
            placeholder={t('wiki.newCategoryPlaceholder')}
            aria-label={t('wiki.newCategoryPlaceholder')}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
            }}
          />
        </label>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={miniBtnGhost}>
          {t('common.cancel')}
        </button>
        <button
          onClick={submit}
          disabled={busy || (mode === 'new' && !newName.trim())}
          style={miniBtn}
        >
          <LuUpload size={13} /> {busy ? t('resources.uploading') : t('wiki.uploadAndEmbed')}
        </button>
      </div>
    </div>
  )
}

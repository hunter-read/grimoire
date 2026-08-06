import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuTrash2, LuChevronLeft, LuImagePlus } from 'react-icons/lu'
import api, { campaigns } from '../../api'
import { useFavorites } from '../../context/FavoritesContext'
import ResourcePicker from './ResourcePicker'
import ScheduleSetup from './ScheduleSetup'
import { labelStyle, inputStyle, cancelBtn, submitBtn, deleteBtn } from './campaignEditorShared'

const CUSTOM_SYSTEM = '__custom__'

export default function CampaignEditor({
  campaign,
  isGmOrAdmin,
  onClose,
  onSaved,
  onDelete,
  onScheduleChanged,
}) {
  const { t } = useTranslation()
  const { isFavorite } = useFavorites()
  const isEdit = !!campaign

  const [step, setStep] = useState(0) // 0 = details, 1 = resources (create only)
  const [form, setForm] = useState({
    name: campaign?.name ?? '',
    description: campaign?.description ?? '',
    is_gm_campaign: campaign?.is_gm_campaign ?? false,
    gm_title: campaign?.gm_title ?? 'Game Master',
    // CUSTOM_SYSTEM when the campaign uses a free-text system name.
    system_id: campaign?.system_id ?? (campaign?.system_name ? CUSTOM_SYSTEM : ''),
    system_name: campaign?.system_name ?? '',
    parent_campaign_id: campaign?.parent_campaign_id ?? '',
  })
  const [selectedResources, setSelectedResources] = useState([])
  const [bannerFile, setBannerFile] = useState(null)
  const bannerInputRef = useRef(null)
  const [systems, setSystems] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Container children (e.g. "Dungeons & Dragons 5e" under the "Dungeons &
  // Dragons" parent-system container) are the systems a campaign is actually
  // played in, so they must be offered here — hence include_children. The
  // containers themselves are folder groupings that hold no books of their own,
  // so they're filtered out below rather than offered as a dead-end choice.
  useEffect(() => {
    api
      .get('/systems?include_children=true')
      .then((data) => setSystems(data || []))
      .catch(() => {})
  }, [])

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  // Split the form's system choice into the two backend fields.
  const systemFields = () => {
    if (form.system_id === CUSTOM_SYSTEM) {
      return { system_id: null, system_name: form.system_name.trim() || null }
    }
    return { system_id: form.system_id || null, system_name: '' }
  }

  const create = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        gm_title: form.gm_title || 'Game Master',
        ...systemFields(),
        parent_campaign_id: form.parent_campaign_id || null,
        is_gm_campaign: form.is_gm_campaign,
        resources: selectedResources.map((r) => ({
          resource_type: r.resource_type,
          resource_id: r.resource_id,
          visibility: r.visibility,
        })),
      }
      const result = await campaigns.create(payload)
      // Upload the optional banner now that the campaign exists.
      if (bannerFile) {
        try {
          await campaigns.uploadBanner(result.id, bannerFile)
          result.has_banner = true
        } catch {
          /* non-fatal — the campaign was created */
        }
      }
      onSaved(result)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        gm_title: form.gm_title || 'Game Master',
        ...systemFields(),
        parent_campaign_id: form.parent_campaign_id || null,
      }
      const result = await campaigns.update(campaign.id, payload)
      onSaved(result)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const next = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError(t('campaignEditor.nameRequired'))
      return
    }
    setError(null)
    setStep(1)
  }

  const submitDetails = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError(t('campaignEditor.nameRequired'))
      return
    }
    saveEdit()
  }

  const showGmTitle = form.is_gm_campaign || (isEdit && campaign?.is_gm_campaign)

  // Only systems you can actually play in are selectable. A container
  // ("Dungeons & Dragons", "One-Page RPGs") is a folder grouping whose books all
  // live on its children, so picking one would scope the campaign to an empty
  // system — its children are offered instead.
  const selectableSystems = systems.filter((s) => !s.container_kind)

  // Group systems for the dropdown: favorited first, then the full list.
  const favoriteSystems = selectableSystems.filter((s) => isFavorite('system', s.id))

  const detailsStep = (
    <>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="campaign-name" style={labelStyle}>
          {t('campaignEditor.nameLabel')}
        </label>
        <input
          id="campaign-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('campaignEditor.namePlaceholder')}
          style={inputStyle}
          autoFocus
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="campaign-description" style={labelStyle}>
          {t('campaignEditor.descriptionLabel')}
        </label>
        <textarea
          id="campaign-description"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder={t('campaignEditor.descriptionPlaceholder')}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {t('campaignEditor.descriptionMarkdownHint')}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="campaign-system" style={labelStyle}>
          {t('campaignEditor.systemLabel')}
        </label>
        <select
          id="campaign-system"
          value={form.system_id}
          onChange={(e) => set('system_id', e.target.value)}
          style={{ ...inputStyle, appearance: 'auto' }}
        >
          <option value="">{t('campaignEditor.systemNone')}</option>
          <option value={CUSTOM_SYSTEM}>{t('campaignEditor.systemCustom')}</option>
          {favoriteSystems.length > 0 && (
            <optgroup label={t('campaignEditor.systemGroupFavorites')}>
              {favoriteSystems.map((s) => (
                <option key={`fav-${s.id}`} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('campaignEditor.systemGroupAll')}>
            {selectableSystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        </select>
        {form.system_id === CUSTOM_SYSTEM && (
          <input
            value={form.system_name}
            onChange={(e) => set('system_name', e.target.value)}
            placeholder={t('campaignEditor.systemCustomPlaceholder')}
            style={{ ...inputStyle, marginTop: 8 }}
            autoFocus
          />
        )}
      </div>

      {!isEdit && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('campaignEditor.bannerLabel')}</label>
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <LuImagePlus size={14} />
            {bannerFile ? bannerFile.name : t('campaignEditor.bannerChoose')}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('campaignDetail.banner.suggestedSize')}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setBannerFile(e.target.files?.[0] || null)}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {showGmTitle && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="campaign-gm-title" style={labelStyle}>
            {t('campaignEditor.gmTitleLabel')}
          </label>
          <input
            id="campaign-gm-title"
            value={form.gm_title}
            onChange={(e) => set('gm_title', e.target.value)}
            placeholder={t('campaignEditor.gmTitlePlaceholder')}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('campaignEditor.gmTitleHint')}
          </div>
        </div>
      )}

      {!isEdit && isGmOrAdmin && (
        <div style={{ marginBottom: 16, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <label
            htmlFor="campaign-is-gm"
            style={{
              ...labelStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              marginTop: 12,
            }}
          >
            <input
              id="campaign-is-gm"
              type="checkbox"
              checked={form.is_gm_campaign}
              onChange={(e) => set('is_gm_campaign', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            {t('campaignEditor.gmCampaignCheckbox')}
          </label>
        </div>
      )}
    </>
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 520,
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>

        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          {isEdit
            ? t('campaignEditor.titleEdit')
            : step === 0
              ? t('campaignEditor.titleNew')
              : t('campaignEditor.resources.title')}
        </h3>
        {!isEdit && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
            {t('campaignEditor.stepIndicator', { current: step + 1, total: 2 })}
          </div>
        )}
        {isEdit && <div style={{ marginBottom: 16 }} />}

        {/* Edit: single step. Create: stepped. */}
        {isEdit ? (
          <>
            {/* The details form submits on Enter; its own submit handler saves. */}
            <form onSubmit={submitDetails}>
              {detailsStep}
              {/* Hidden submit lets Enter save while the visible action buttons
                  live below the schedule section. */}
              <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
            </form>

            {/* Schedule setup (GM campaigns only) lives here rather than on the
                overview, positioned just above the action buttons. */}
            {campaign?.is_gm_campaign && (
              <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                <div style={{ ...labelStyle, marginBottom: 10 }}>
                  {t('campaignEditor.scheduleLabel')}
                </div>
                <ScheduleSetup campaign={campaign} onChanged={onScheduleChanged} />
              </div>
            )}

            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 13, margin: '16px 0 12px' }}>
                {error}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                marginTop: 20,
                paddingTop: 18,
                borderTop: '1px solid var(--border)',
              }}
            >
              {onDelete && (
                <button type="button" onClick={onDelete} disabled={saving} style={deleteBtn}>
                  <LuTrash2 size={14} /> {t('campaignEditor.delete')}
                </button>
              )}
              <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                <button type="button" onClick={onClose} style={cancelBtn}>
                  {t('campaignEditor.cancel')}
                </button>
                <button type="button" onClick={submitDetails} disabled={saving} style={submitBtn}>
                  {saving ? t('campaignEditor.saving') : t('campaignEditor.saveChanges')}
                </button>
              </div>
            </div>
          </>
        ) : step === 0 ? (
          <form onSubmit={next}>
            {detailsStep}
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={cancelBtn}>
                {t('campaignEditor.cancel')}
              </button>
              <button type="submit" style={submitBtn}>
                {t('campaignEditor.next')}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <ResourcePicker
              systemId={form.system_id}
              selected={selectedResources}
              setSelected={setSelectedResources}
              preselectCore
              pinSystem={systems.find((s) => s.id === form.system_id)?.name || ''}
            />
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0' }}>{error}</div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 10,
                justifyContent: 'space-between',
                marginTop: 20,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStep(0)
                }}
                style={{ ...cancelBtn, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <LuChevronLeft size={14} /> {t('campaignEditor.back')}
              </button>
              <button type="button" onClick={create} disabled={saving} style={submitBtn}>
                {saving ? t('campaignEditor.saving') : t('campaignEditor.createCampaign')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

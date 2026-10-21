import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuX } from 'react-icons/lu'
import api, { auth } from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'
import { useUISettings } from '../../context/UISettingsContext'
import UserRow from './UserRow'
import AddUserForm from './AddUserForm'
import GuestsSection from './GuestsSection'
import ShareLinkRolesSection from './ShareLinkRolesSection'

const COLUMN_COUNT = 6

type User = Schema<'UserOut'>

const message = (err: unknown) => (err as Error)?.message

export default function UsersTab() {
  const { t } = useTranslation()
  const currentUser = useAuth()?.user
  const { api_keys_enabled: keysEnabled, share_links_enabled: shareEnabled } = useUISettings()
  const [users, setUsers] = useState<User[] | null>(null)
  const [passwordAuthEnabled, setPasswordAuthEnabled] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/users').then(setUsers)
    auth
      .config()
      .then((c) => setPasswordAuthEnabled(c?.password_auth_enabled !== false))
      .catch(() => {})
  }, [])

  // Merge a PATCH response into the existing row without dropping derived
  // fields the update endpoint doesn't echo back (e.g. campaign_count).
  const mergeUser = (response: unknown) => {
    const updated = response as Partial<User> & { id: string }
    setUsers((prev) => (prev ?? []).map((u) => (u.id === updated.id ? { ...u, ...updated } : u)))
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { role: newRole }))
    } catch (err) {
      setError(message(err) || t('users.failedUpdateRole'))
    }
  }

  const handleExplicitChange = async (userId: string, allowed: boolean) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { allow_explicit: allowed }))
    } catch (err) {
      setError(message(err) || t('users.failedUpdateExplicit'))
    }
  }

  const handleCampaignAccessChange = async (userId: string, allowed: boolean) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { campaign_access: allowed }))
    } catch (err) {
      setError(message(err) || t('users.failedUpdateCampaignAccess'))
    }
  }

  const handleApiKeysChange = async (userId: string, allowed: boolean) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { api_keys_enabled: allowed }))
    } catch (err) {
      setError(message(err) || t('users.failedUpdateApiKeys'))
    }
  }

  const handleShareLinksChange = async (userId: string, override: string) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { share_links: override }))
    } catch (err) {
      setError(message(err) || t('users.shareLinks.failedUpdate'))
    }
  }

  const handlePasswordReset = async (userId: string, newPassword: string) => {
    try {
      await api.patch(`/users/${userId}`, { password: newPassword })
    } catch (err) {
      setError(message(err) || t('users.failedSetPassword'))
      throw err
    }
  }

  const handleEmailChange = async (userId: string, newEmail: string) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { email: newEmail }))
    } catch (err) {
      setError(message(err) || t('users.failedSetEmail'))
      throw err
    }
  }

  const handleDelete = async (userId: string) => {
    try {
      await api.delete(`/users/${userId}`)
      setUsers((prev) => (prev ?? []).filter((u) => u.id !== userId))
      if (expandedId === userId) setExpandedId(null)
    } catch (err) {
      setError(message(err) || t('users.failedDeleteUser'))
    }
  }

  const handleAdd = (newUser: User) => {
    setUsers((prev) => [
      ...(prev ?? []),
      {
        ...newUser,
        campaign_count: newUser.campaign_count ?? 0,
        created_at: newUser.created_at ?? new Date().toISOString(),
      },
    ])
    setShowAddForm(false)
  }

  // A converted guest becomes a permanent user, so surface it in the main list.
  const handleGuestConverted = (newUser?: User | null) => {
    if (newUser) setUsers((prev) => [...(prev ?? []), newUser])
  }

  if (!users)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={24} />
      </div>
    )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {t('users.userCount', { count: users.length })}
        </p>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ ...primaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {showAddForm ? (
            <>
              <LuX size={13} /> {t('users.cancelAdd')}
            </>
          ) : (
            <>
              <LuPlus size={13} /> {t('users.addUser')}
            </>
          )}
        </button>
      </div>

      {shareEnabled !== false && (
        <ShareLinkRolesSection onChanged={() => api.get('/users').then(setUsers)} />
      )}

      {showAddForm && (
        <AddUserForm
          passwordAuthEnabled={passwordAuthEnabled}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {error && (
        <div
          style={{
            color: 'var(--red)',
            fontSize: 13,
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(196, 80, 64, 0.1)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {error}
          <button
            onClick={() => setError('')}
            aria-label="Dismiss error"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--red)',
              display: 'flex',
            }}
          >
            <LuX size={13} />
          </button>
        </div>
      )}

      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          // Scroll the wide table within its card on narrow screens instead of
          // clipping columns or pushing the whole page sideways.
          overflowX: 'auto',
          marginTop: showAddForm ? 16 : 0,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, width: 28 }} aria-hidden="true" />
              <th style={headStyle}>{t('users.username')}</th>
              <th style={headStyle}>{t('users.role')}</th>
              <th style={headStyle}>{t('users.permissions')}</th>
              <th style={headStyle}>{t('users.activity.column')}</th>
              <th style={{ ...headStyle, textAlign: 'right' }}>{t('users.campaignAccess')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                currentUserId={currentUser?.id ?? ''}
                currentUserRole={currentUser?.role ?? ''}
                passwordAuthEnabled={passwordAuthEnabled}
                expanded={expandedId === u.id}
                onToggleExpand={() => setExpandedId((id) => (id === u.id ? null : u.id))}
                columnCount={COLUMN_COUNT}
                onRoleChange={handleRoleChange}
                onExplicitChange={handleExplicitChange}
                onCampaignAccessChange={handleCampaignAccessChange}
                apiKeysEnabled={keysEnabled !== false}
                onApiKeysChange={handleApiKeysChange}
                shareLinksEnabled={shareEnabled !== false}
                onShareLinksChange={handleShareLinksChange}
                onPasswordReset={handlePasswordReset}
                onEmailChange={handleEmailChange}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* `users` lets the merge picker offer permanent accounts as a target, so
          a guest can be folded into the real account that person already has. */}
      <GuestsSection
        passwordAuthEnabled={passwordAuthEnabled}
        users={users}
        onConverted={handleGuestConverted}
      />
    </div>
  )
}

const headStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  background: 'var(--bg-deep)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

const primaryBtnStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}

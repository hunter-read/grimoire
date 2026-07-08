import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuX } from 'react-icons/lu'
import api, { auth } from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'
import UserRow from './UserRow'
import AddUserForm from './AddUserForm'
import GuestsSection from './GuestsSection'

const COLUMN_COUNT = 5

export default function UsersTab() {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState(null)
  const [passwordAuthEnabled, setPasswordAuthEnabled] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
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
  const mergeUser = (updated) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)))

  const handleRoleChange = async (userId, newRole) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { role: newRole }))
    } catch (err) {
      setError(err.message || t('users.failedUpdateRole'))
    }
  }

  const handleExplicitChange = async (userId, allowed) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { allow_explicit: allowed }))
    } catch (err) {
      setError(err.message || t('users.failedUpdateExplicit'))
    }
  }

  const handleCampaignAccessChange = async (userId, allowed) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { campaign_access: allowed }))
    } catch (err) {
      setError(err.message || t('users.failedUpdateCampaignAccess'))
    }
  }

  const handlePasswordReset = async (userId, newPassword) => {
    try {
      await api.patch(`/users/${userId}`, { password: newPassword })
    } catch (err) {
      setError(err.message || t('users.failedSetPassword'))
      throw err
    }
  }

  const handleEmailChange = async (userId, newEmail) => {
    try {
      mergeUser(await api.patch(`/users/${userId}`, { email: newEmail }))
    } catch (err) {
      setError(err.message || t('users.failedSetEmail'))
      throw err
    }
  }

  const handleDelete = async (userId) => {
    try {
      await api.delete(`/users/${userId}`)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      if (expandedId === userId) setExpandedId(null)
    } catch (err) {
      setError(err.message || t('users.failedDeleteUser'))
    }
  }

  const handleAdd = (newUser) => {
    setUsers((prev) => [
      ...prev,
      { campaign_count: 0, created_at: new Date().toISOString(), ...newUser },
    ])
    setShowAddForm(false)
  }

  // A converted guest becomes a permanent user, so surface it in the main list.
  const handleGuestConverted = (newUser) => {
    if (newUser) setUsers((prev) => [...prev, newUser])
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
          overflow: 'hidden',
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
              <th style={{ ...headStyle, textAlign: 'right' }}>{t('users.campaignAccess')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                currentUserId={currentUser.id}
                currentUserRole={currentUser.role}
                passwordAuthEnabled={passwordAuthEnabled}
                expanded={expandedId === u.id}
                onToggleExpand={() => setExpandedId((id) => (id === u.id ? null : u.id))}
                columnCount={COLUMN_COUNT}
                onRoleChange={handleRoleChange}
                onExplicitChange={handleExplicitChange}
                onCampaignAccessChange={handleCampaignAccessChange}
                onPasswordReset={handlePasswordReset}
                onEmailChange={handleEmailChange}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      <GuestsSection passwordAuthEnabled={passwordAuthEnabled} onConverted={handleGuestConverted} />
    </div>
  )
}

const headStyle = {
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

const primaryBtnStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}

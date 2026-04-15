import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuX } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'
import UserRow from './UserRow'
import AddUserForm from './AddUserForm'

export default function UsersTab() {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { api.get('/users').then(setUsers) }, [])

  const handleRoleChange = async (userId, newRole) => {
    try {
      const updated = await api.patch(`/users/${userId}`, { role: newRole })
      setUsers(users.map(u => u.id === updated.id ? { ...u, role: updated.role } : u))
    } catch (err) {
      setError(err.message || t('users.failedUpdateRole'))
    }
  }

  const handleExplicitChange = async (userId, allowed) => {
    try {
      const updated = await api.patch(`/users/${userId}`, { allow_explicit: allowed })
      setUsers(users.map(u => u.id === updated.id ? { ...u, allow_explicit: updated.allow_explicit } : u))
    } catch (err) {
      setError(err.message || t('users.failedUpdateExplicit'))
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

  const handleDelete = async (userId) => {
    try {
      await api.delete(`/users/${userId}`)
      setUsers(users.filter(u => u.id !== userId))
    } catch (err) {
      setError(err.message || t('users.failedDeleteUser'))
    }
  }

  const handleAdd = (newUser) => {
    setUsers([...users, { ...newUser, created_at: new Date().toISOString() }])
    setShowAddForm(false)
  }

  if (!users) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {t('users.userCount', { count: users.length })}
        </p>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ ...primaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {showAddForm ? <><LuX size={13} /> {t('users.cancelAdd')}</> : <><LuPlus size={13} /> {t('users.addUser')}</>}
        </button>
      </div>

      {showAddForm && (
        <AddUserForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
      )}

      {error && (
        <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'rgba(196, 80, 64, 0.1)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', display: 'flex' }}>
            <LuX size={13} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: showAddForm ? 16 : 0 }}>
        {users.map(u => (
          <UserRow
            key={u.id}
            user={u}
            currentUserId={currentUser.id}
            onRoleChange={handleRoleChange}
            onExplicitChange={handleExplicitChange}
            onPasswordReset={handlePasswordReset}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}

const primaryBtnStyle = {
  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
  background: 'var(--gold-dim)', color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)', cursor: 'pointer',
}

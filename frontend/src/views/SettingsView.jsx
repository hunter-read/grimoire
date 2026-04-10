import { useParams } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import UsersTab from '../components/settings/UsersTab'
import MaintenanceTab from '../components/settings/MaintenanceTab'
import UserSettingsTab from '../components/settings/UserSettingsTab'
import AppSettingsTab from '../components/settings/AppSettingsTab'
import LogsTab from '../components/settings/LogsTab'

const ADMIN_TABS = [
  { key: 'account',     label: 'Account'     },
  { key: 'users',       label: 'Users'       },
  { key: 'application', label: 'Application' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'logs',        label: 'Logs'        },
]

const USER_TABS = [
  { key: 'account', label: 'Account' },
]

export default function SettingsView({ user, onLogout }) {
  const { tab } = useParams()
  const isAdmin = user?.role === 'admin'
  const tabs = isAdmin ? ADMIN_TABS : USER_TABS

  return (
    <div className="fade-in" style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 40px)', maxWidth: 900, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: 28, marginBottom: 28 }}>Settings</h2>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 28, overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        {tabs.map(t => (
          <NavLink
            key={t.key}
            to={`/settings/${t.key}`}
            style={({ isActive }) => ({
              padding: '8px 20px', background: 'none', border: 'none',
              borderBottom: isActive ? '2px solid var(--gold)' : '2px solid transparent',
              color: isActive ? 'var(--gold)' : 'var(--text-dim)',
              fontSize: 14, fontWeight: isActive ? 600 : 400,
              marginBottom: -1, cursor: 'pointer', transition: 'color 0.15s',
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            })}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {tab === 'account'     && <UserSettingsTab user={user} onLogout={onLogout} />}
      {tab === 'users'       && isAdmin && <UsersTab />}
      {tab === 'application' && isAdmin && <AppSettingsTab />}
      {tab === 'maintenance' && isAdmin && <MaintenanceTab />}
      {tab === 'logs'        && isAdmin && <LogsTab />}
    </div>
  )
}

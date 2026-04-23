import { useParams } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import UsersTab from '../components/settings/UsersTab'
import MaintenanceTab from '../components/settings/MaintenanceTab'
import UserSettingsTab from '../components/settings/UserSettingsTab'
import AppSettingsTab from '../components/settings/AppSettingsTab'
import LogsTab from '../components/settings/LogsTab'

export default function SettingsView({ user, onLogout }) {
  const { t } = useTranslation()
  const { tab } = useParams()
  const isAdmin = user?.role === 'admin'

  const ADMIN_TABS = [
    { key: 'account', label: t('settings.tabs.account') },
    { key: 'users', label: t('settings.tabs.users') },
    { key: 'application', label: t('settings.tabs.application') },
    { key: 'maintenance', label: t('settings.tabs.maintenance') },
    { key: 'logs', label: t('settings.tabs.logs') },
  ]

  const USER_TABS = [{ key: 'account', label: t('settings.tabs.account') }]

  const tabs = isAdmin ? ADMIN_TABS : USER_TABS

  return (
    <div
      className="fade-in"
      style={{
        padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 40px)',
        maxWidth: 900,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <h2 style={{ fontSize: 28, marginBottom: 28 }}>{t('settings.title')}</h2>

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 28,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tabItem) => (
          <NavLink
            key={tabItem.key}
            to={`/settings/${tabItem.key}`}
            style={({ isActive }) => ({
              padding: '8px 20px',
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--gold)' : '2px solid transparent',
              color: isActive ? 'var(--gold)' : 'var(--text-dim)',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              marginBottom: -1,
              cursor: 'pointer',
              transition: 'color 0.15s',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            })}
          >
            {tabItem.label}
          </NavLink>
        ))}
      </div>

      {tab === 'account' && <UserSettingsTab user={user} onLogout={onLogout} />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'application' && isAdmin && <AppSettingsTab />}
      {tab === 'maintenance' && isAdmin && <MaintenanceTab />}
      {tab === 'logs' && isAdmin && <LogsTab />}
    </div>
  )
}

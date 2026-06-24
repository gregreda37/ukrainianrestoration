import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from './useAuth'

const BASE_NAV = [
  { to: '/myclaim',              label: 'Dashboard',    icon: '▦',  end: true },
  { to: '/myclaim/clients',      label: 'Clients',      icon: '👥' },
  { to: '/myclaim/chatbot',      label: 'AI Assistant', icon: '🤖' },
  { to: '/myclaim/settings',     label: 'Settings',     icon: '⚙️' },
]
const ADMIN_NAV = { to: '/myclaim/team', label: 'Team', icon: '👤' }

export default function ClaimLayout() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const nav = isAdmin ? [...BASE_NAV.slice(0, 3), ADMIN_NAV, BASE_NAV[3]] : BASE_NAV

  async function handleSignOut() {
    await signOut(auth)
    navigate('/myclaim/login')
  }

  return (
    <div className="mc-shell">
      <aside className="mc-sidebar">
        <div className="mc-sidebar__brand">
          <span className="mc-sidebar__logo">UR</span>
          <span className="mc-sidebar__name">MyClaim</span>
        </div>

        <nav className="mc-nav">
          {nav.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `mc-nav__item${isActive ? ' mc-nav__item--active' : ''}`}
            >
              <span className="mc-nav__icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mc-sidebar__footer">
          <div className="mc-sidebar__user">
            <div className="mc-sidebar__avatar">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="mc-sidebar__email">{user?.email}</div>
          </div>
          <button className="mc-sidebar__signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="mc-main">
        <Outlet />
      </main>
    </div>
  )
}

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { createContext, useContext, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from './useAuth'

export const NavCollapseContext = createContext(null)
export const useNavCollapse = () => useContext(NavCollapseContext)

const BASE_NAV = [
  { to: '/myclaim',              label: 'Dashboard',   icon: '▦',  end: true },
  { to: '/myclaim/clients',      label: 'Clients',     icon: '👥' },
  { to: '/myclaim/ai',           label: 'AI Analysis', icon: '🤖', adminOnly: true },
  { to: '/myclaim/settings',     label: 'Settings',    icon: '⚙️' },
]
const ADMIN_NAV = { to: '/myclaim/team', label: 'Team', icon: '👤', adminOnly: true }

export default function ClaimLayout() {
  const { user, isAdmin, role } = useAuth()
  const navigate = useNavigate()
  const isProjectManager = role === 'project_manager'
  const fullNav = [...BASE_NAV.slice(0, 3), ADMIN_NAV, BASE_NAV[3]]
  const nav = fullNav.filter(item => !item.adminOnly || isAdmin)

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('mc-nav-collapsed') === 'true'
  )

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('mc-nav-collapsed', String(next))
      return next
    })
  }

  async function handleSignOut() {
    await signOut(auth)
    navigate('/myclaim/login')
  }

  function collapseNav() {
    setCollapsed(true)
    localStorage.setItem('mc-nav-collapsed', 'true')
  }

  return (
    <NavCollapseContext.Provider value={collapseNav}>
    <div className="mc-shell">
      <aside className={`mc-sidebar${collapsed ? ' mc-sidebar--collapsed' : ''}`}>
        <div className="mc-sidebar__brand">
          <span className="mc-sidebar__logo">UR</span>
          {!collapsed && <span className="mc-sidebar__name">MyClaim</span>}
          <button
            className="mc-sidebar__toggle"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className="mc-nav">
          {nav.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `mc-nav__item${isActive ? ' mc-nav__item--active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <span className="mc-nav__icon">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mc-sidebar__footer">
          {!collapsed && (
            <div className="mc-sidebar__user">
              <div className="mc-sidebar__avatar">
                {user?.email?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="mc-sidebar__email">{user?.email}</div>
            </div>
          )}
          {collapsed ? (
            <button
              className="mc-sidebar__signout mc-sidebar__signout--icon"
              onClick={handleSignOut}
              title="Sign out"
            >
              ⎋
            </button>
          ) : (
            <button className="mc-sidebar__signout" onClick={handleSignOut}>
              Sign out
            </button>
          )}
        </div>
      </aside>

      <main className="mc-main">
        <Outlet />
      </main>

      <nav className="mc-bottomnav">
        {nav.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `mc-bottomnav__item${isActive ? ' mc-bottomnav__item--active' : ''}`}
          >
            <span className="mc-bottomnav__icon">{icon}</span>
            <span className="mc-bottomnav__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
    </NavCollapseContext.Provider>
  )
}

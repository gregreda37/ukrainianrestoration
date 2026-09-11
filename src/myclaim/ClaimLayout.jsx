import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { createContext, useContext, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from './useAuth'

export const NavCollapseContext = createContext(null)
export const useNavCollapse = () => useContext(NavCollapseContext)

export const DensityContext = createContext(null)
export const useDensity = () => useContext(DensityContext)

const ALL_NAV = [
  { to: '/myclaim',               label: 'Dashboard',   icon: '▦',  end: true },
  { to: '/myclaim/clients',       label: 'Clients',     icon: '👥' },
  { to: '/myclaim/open-work',     label: 'Invoices',    icon: '🧾' },
  { to: '/myclaim/invoices',      label: 'Sales Report', icon: '📊', pmBlocked: true },
  { to: '/myclaim/partners',       label: 'Partners',    icon: '🤝', pmBlocked: true },
  { to: '/myclaim/ai',            label: 'AI Analysis', icon: '🤖', pmBlocked: true },
  { to: '/myclaim/settings',      label: 'Settings',    icon: '⚙️' },
]

export default function ClaimLayout() {
  const { user, isAdmin, role, loading } = useAuth()
  const navigate = useNavigate()
  const nav = ALL_NAV.filter(item => {
    if (item.adminOnly) return isAdmin
    // Don't show pmBlocked items while role is still loading (null) — avoids flash
    // for PM users who would otherwise see the item briefly before it disappears
    if (item.pmBlocked) return role !== null && role !== 'project_manager'
    return true
  })

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('mc-nav-collapsed') === 'true'
  )

  const [density, setDensity] = useState(
    () => localStorage.getItem('mc-density') || 'medium'
  )

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('mc-nav-collapsed', String(next))
      return next
    })
  }

  function setDensityPref(val) {
    setDensity(val)
    localStorage.setItem('mc-density', val)
  }

  const ZOOM = { large: 1, medium: 0.85, small: 0.72 }

  async function handleSignOut() {
    await signOut(auth)
    navigate('/myclaim/login')
  }

  function collapseNav() {
    setCollapsed(true)
    localStorage.setItem('mc-nav-collapsed', 'true')
  }

  return (
    <DensityContext.Provider value={{ density, setDensityPref }}>
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
            <div className="mc-sidebar__density">
              <span className="mc-sidebar__density-label">Layout</span>
              <div className="mc-sidebar__density-btns">
                {['small', 'medium', 'large'].map(d => (
                  <button
                    key={d}
                    className={`mc-density-btn${density === d ? ' mc-density-btn--active' : ''}`}
                    onClick={() => setDensityPref(d)}
                    title={d.charAt(0).toUpperCase() + d.slice(1)}
                  >
                    {d === 'small' ? 'S' : d === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>
          )}
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
        <div style={ZOOM[density] < 1 ? {
          transform: `scale(${ZOOM[density]})`,
          transformOrigin: 'top left',
          width: `${100 / ZOOM[density]}%`,
        } : undefined}>
          <Outlet />
        </div>
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
    </DensityContext.Provider>
  )
}

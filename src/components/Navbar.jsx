import { useState, useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/projects', label: 'Projects' },
  { to: '/water-damage', label: 'Water Damage' },
  { to: '/handyman', label: 'Handyman' },
  { to: '/junk-removal', label: 'Junk Removal' },
]

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const close = () => setIsOpen(false)

  return (
    <nav className={`navbar${scrolled ? ' navbar--scrolled' : ''}`}>
      <div className="container navbar__inner">
        <Link to="/" className="navbar__logo" onClick={close}>
          <img src="/logp.png" alt="Ukrainian Restoration" className="navbar__logo-img" />
        </Link>

        <ul className={`navbar__links${isOpen ? ' navbar__links--open' : ''}`}>
          {NAV_LINKS.map(({ to, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={close}
              >
                {label}
              </NavLink>
            </li>
          ))}
          <li>
            <Link to="/myclaim/login" className="btn btn-primary navbar__cta" onClick={close}>
              View My Claim
            </Link>
          </li>
        </ul>

        <button
          className={`navbar__burger${isOpen ? ' open' : ''}`}
          onClick={() => setIsOpen(o => !o)}
          aria-label="Toggle navigation"
        >
          <span /><span /><span />
        </button>
      </div>
    </nav>
  )
}

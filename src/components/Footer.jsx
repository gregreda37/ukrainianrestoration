import { Link } from 'react-router-dom'

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.82 19.79 19.79 0 012 1.18 2 2 0 014 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>
)

const MailIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
)

const MapPinIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
)

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <div className="footer__logo">
              <strong>Ukrainian</strong> Restoration LLC
            </div>
            <p>
              Fully licensed, insured &amp; bonded local contractor serving New Jersey.
              From emergency water damage recovery to complete home renovations — we help
              you rebuild with confidence.
            </p>
            <div className="footer__certs">
              <span>NJ.LIC #13VH10509300</span>
              <span>IICRC Certified #70037130</span>
              <span>EPA Lead Certified</span>
            </div>
          </div>

          <div className="footer__col">
            <h4>Pages</h4>
            <ul>
              <li><Link to="/">Home</Link></li>
              <li><Link to="/about">About</Link></li>
              <li><Link to="/projects">Projects</Link></li>
              <li><Link to="/contact">Contact</Link></li>
            </ul>
          </div>

          <div className="footer__col">
            <h4>Services</h4>
            <ul>
              <li><Link to="/water-damage">Water Damage</Link></li>
              <li><Link to="/projects">Kitchen Remodeling</Link></li>
              <li><Link to="/projects">Bathroom Renovation</Link></li>
              <li><Link to="/handyman">Handyman</Link></li>
              <li><Link to="/junk-removal">Junk Removal</Link></li>
            </ul>
          </div>

          <div className="footer__col">
            <h4>Contact</h4>
            <div className="footer__contact-item">
              <PhoneIcon />
              <a href="tel:+19732194973">(973) 219-4973</a>
            </div>
            <div className="footer__contact-item">
              <MailIcon />
              <span>info@ukrainianrestoration.com</span>
            </div>
            <div className="footer__contact-item">
              <MapPinIcon />
              <span>New Jersey &amp; Surrounding Areas</span>
            </div>
          </div>
        </div>

        <div className="footer__bottom">
          <span>&copy; {year} Ukrainian Restoration LLC. All rights reserved.</span>
          <span className="footer__legal-links">
            <Link to="/terms">Terms &amp; Conditions</Link>
            <span aria-hidden="true">&bull;</span>
            <Link to="/privacy">Privacy Policy</Link>
          </span>
          <span>Licensed &amp; Insured &bull; NJ.LIC #13VH10509300</span>
        </div>
      </div>
    </footer>
  )
}

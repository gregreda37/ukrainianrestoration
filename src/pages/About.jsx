import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'
import imgGreg        from '../assets/portfolio/headshots/greg.jpg'
import imgZach        from '../assets/portfolio/headshots/zach.jpeg'
import imgDaniel      from '../assets/portfolio/headshots/daniel.jpg'
import imgWildinJr    from '../assets/portfolio/headshots/willjr.jpg'
import imgWildinSr    from '../assets/portfolio/headshots/willsr.jpg'
import imgNeilson     from '../assets/portfolio/headshots/nilson.jpg'

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
)

const StarIcon = () => (
  <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
)

const UsersIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
)

const HeartIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
)

const VALUES = [
  { icon: <ShieldIcon />, title: 'Honor & Integrity', desc: 'We say what we mean and do what we say. Transparent pricing, honest timelines, no surprises.' },
  { icon: <StarIcon />, title: 'Craftsmanship', desc: 'Precision in every cut, tile, and finish. We take pride in the details that others overlook.' },
  { icon: <UsersIcon />, title: 'Family First', desc: 'We\'re brothers who built this company together. We treat every client\'s home as if it were our own family\'s.' },
  { icon: <HeartIcon />, title: 'Community Roots', desc: 'Grounded in the Ukrainian community we grew up in. The Kozak spirit — strength, courage, independence — guides our work.' },
]

const TEAM = [
  {
    name: 'Greg',
    role: 'Co-Founder',
    bio: 'Drew University alum. Greg oversees project operations, client relationships, and business development. He grew up learning construction from his grandfather and never stopped.',
    photo: imgGreg,
  },
  {
    name: 'Zach',
    role: 'Co-Founder',
    bio: 'University of Miami alum. Zach leads on-site work, crew coordination, and quality control. His eye for detail and hands-on approach set the standard for every job.',
    photo: imgZach,
  },
  {
    name: 'Daniel',
    role: 'Project Manager',
    bio: 'Daniel keeps every job running on time and on budget. He coordinates scheduling, manages subcontractors, and serves as the main point of contact from start to finish.',
    photo: imgDaniel,
  },
  {
    name: 'Wildin Jr',
    role: 'Electrician',
    bio: 'Wildin Jr handles all electrical work — from panel upgrades and circuit runs to fixture installation and final inspections. Reliable, code-compliant, and precise.',
    photo: imgWildinJr,
  },
  {
    name: 'Wildin Senior',
    role: 'Master Tile Installer',
    bio: 'With decades of experience, Wildin Senior brings expert-level craftsmanship to every tile installation — floors, walls, showers, and custom patterns.',
    photo: imgWildinSr,
  },
  {
    name: 'Neilson',
    role: 'Master Drywall Installer',
    bio: 'Neilson delivers flawless drywall — hanging, taping, finishing, and texture work. His smooth walls and tight seams are the foundation every great renovation is built on.',
    photo: imgNeilson,
  },
]

const CERTS = [
  { label: 'NJ Contractor License', detail: 'NJ.LIC #13VH10509300' },
  { label: 'IICRC Water & Fire Certified', detail: 'Firm #70037130' },
  { label: 'EPA Lead Certified', detail: 'NAT-F293920-1' },
  { label: 'A-901 Certified Dumping Firm', detail: 'NJDEP #0040532' },
]

export default function About() {
  useSEO({
    title: 'About Ukrainian Restoration | Licensed NJ Contractor — Greg & Zach',
    description: 'Meet the team behind Ukrainian Restoration LLC — IICRC-certified, NJ-licensed brothers Greg and Zach. Built on Ukrainian heritage and hands-on construction experience.',
    canonical: '/about',
  })
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>About Ukrainian Restoration</h1>
          <p>Two brothers, one grandfather's lessons, and a commitment to building something beautiful.</p>
        </div>
      </div>

      {/* Story */}
      <section className="section">
        <div className="container">
          <div className="story-grid">
            <div className="story-img">
              <img src="/dido.JPG" alt="The Ukrainian Restoration team" />
            </div>
            <div className="story-text">
              <div className="sec-label">How We Got Here</div>
              <h2>From a Grandfather's Workshop to Your Front Door</h2>
              <p>
                Greg and Zach grew up in a close-knit Ukrainian community, spending summers
                learning construction from their grandfather — measuring, cutting, finishing,
                and doing the work right the first time.
              </p>
              <p>
                Both brothers went on to study software engineering: Greg at Drew University
                in New Jersey, Zach at the University of Miami. After years in corporate
                roles, they chose to build something of their own — returning to the craft
                that shaped them.
              </p>
              <p>
                Ukrainian Restoration LLC started in water remediation and grew into a
                full-service construction company. Today they handle everything from
                emergency water damage recovery to complete kitchen and bathroom renovations,
                handyman work, and junk removal.
              </p>
              <p style={{ marginTop: 16, fontStyle: 'italic', color: 'var(--clr-text-lt)' }}>
                "We approach every project with passion, discipline, and pride in our craft."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Kozak section */}
      <section className="section section--alt">
        <div className="container">
          <div className="grid-2">
            <div>
              <div className="sec-label">Our Name &amp; Symbol</div>
              <h2>The Kozak Spirit</h2>
              <p>
                The company name honors the Ukrainian heritage and upbringing that shaped
                Greg and Zach. Our logo features a Kozak — the iconic Ukrainian warrior
                symbol representing <strong>strength, courage, and independence</strong>.
              </p>
              <p>
                For us, the Kozak spirit is more than a logo. It's how we show up to work:
                with discipline, with pride, and with a willingness to take on the hard jobs
                that others won't.
              </p>
            </div>
            <div className="kozak-img">
              <img src="/ukrainian.jpeg" alt="Greg and Zach in traditional Ukrainian dress" />
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">What We Stand For</div>
            <h2 className="sec-title">Core Values</h2>
          </div>
          <div className="values-grid">
            {VALUES.map(({ icon, title, desc }) => (
              <div className="card value-card" key={title}>
                <div className="value-card__icon">{icon}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="section section--alt">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Our Team</div>
            <h2 className="sec-title">Ukrainian Restoration Team</h2>
          </div>
          <div className="team-grid">
            {TEAM.map(({ name, role, bio, photo }) => (
              <div className="card team-card" key={name}>
                <div className="team-card__photo">
                  <img src={photo} alt={name} />
                </div>
                <div className="team-card__info">
                  <div className="team-card__name">{name}</div>
                  <div className="team-card__role">{role}</div>
                  <p className="team-card__bio">{bio}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Certifications */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Credentials</div>
            <h2 className="sec-title">Licensed, Certified &amp; Bonded</h2>
            <p className="sec-sub">Every license and certification required to protect you and your property — fully current.</p>
          </div>
          <div className="certs-grid">
            {CERTS.map(({ label, detail }) => (
              <div className="cert-card card" key={label}>
                <div className="cert-card__check">&#10003;</div>
                <h4>{label}</h4>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Let&#39;s Build Something Together</h2>
        <p>Call us or send a message to get your free estimate.</p>
        <div className="cta-banner__actions">
          <a href="tel:+19732194973" className="btn btn-accent">Call (973) 219-4973</a>
          <Link to="/contact" className="btn btn-outline-white">Send a Message</Link>
        </div>
      </section>
    </>
  )
}

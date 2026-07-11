import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'

const STEPS = [
  { num: '01', title: 'Emergency Assessment', desc: 'We respond fast. Our team assesses the damage, identifies water sources, and documents everything for your insurance claim.' },
  { num: '02', title: 'Water Extraction', desc: 'Industrial-grade extraction equipment removes standing water quickly to prevent further structural damage and mold growth.' },
  { num: '03', title: 'Structural Drying', desc: 'Commercial dehumidifiers and air movers dry walls, subfloors, and framing to IICRC moisture standards.' },
  { num: '04', title: 'Antimicrobial Treatment', desc: 'We apply EPA-registered antimicrobial agents to all affected surfaces to eliminate bacteria and prevent mold before reconstruction.' },
  { num: '05', title: 'Demolition of Damaged Materials', desc: 'Saturated drywall, insulation, and flooring are removed safely to expose and fully dry structural members.' },
  { num: '06', title: 'Full Reconstruction', desc: 'From drywall and painting to flooring and cabinetry — we rebuild everything back to pre-loss condition or better.' },
]

const COVERAGE = [
  'Burst or frozen pipes',
  'Appliance overflow (washer, dishwasher)',
  'Roof leaks and storm water intrusion',
  'Sewage backups',
  'Sump pump failure',
  'Flooding',
  'Fire suppression / sprinkler damage',
]

export default function WaterDamage() {
  useSEO({
    title: 'Water & Fire Damage Restoration New Jersey | IICRC Certified | Ukrainian Restoration',
    description: 'IICRC-certified water damage restoration in New Jersey. Emergency extraction, structural drying, mold prevention & full reconstruction. NJ.LIC #13VH10509300. Call (973) 219-4973.',
    canonical: '/water-damage',
  })
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Water Damage Recovery</h1>
          <p>IICRC Water &amp; Fire Certified. We handle the crisis and the full reconstruction — one company, start to finish.</p>
        </div>
      </div>

      {/* Cert callout */}
      <div className="cert-banner">
        <div className="container cert-banner__inner">
          <div className="cert-banner__badge">IICRC Certified</div>
          <p>Firm #70037130 · EPA Lead Certified NAT-F293920-1 · NJ.LIC #13VH10509300</p>
          <a href="tel:+19732194973" className="btn btn-primary">Emergency Line: (973) 219-4973</a>
        </div>
      </div>

      {/* Process */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Our Process</div>
            <h2 className="sec-title">End-to-End Water Damage Restoration</h2>
            <p className="sec-sub">
              Unlike mitigation-only contractors, we handle every phase — from the emergency call
              through complete reconstruction — so you only deal with one company.
            </p>
          </div>
          <div className="process-grid">
            {STEPS.map(({ num, title, desc }) => (
              <div className="process-step card" key={num}>
                <div className="process-step__num">{num}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we cover */}
      <section className="section section--alt">
        <div className="container">
          <div className="grid-2">
            <div className="coverage-section">
              <div className="sec-label">What We Handle</div>
              <h2>Common Water Damage Situations</h2>
              <p style={{ color: 'var(--clr-text-lt)', marginBottom: 24 }}>
                If you&#39;re not sure whether your situation qualifies, call us. We&#39;ll give you
                an honest assessment at no cost.
              </p>
              <ul className="coverage-list">
                {COVERAGE.map(item => (
                  <li key={item}>
                    <span className="coverage-list__check">&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="img-ph about-img">
              <div className="ph-block">
                <div className="ph-block__icon">&#128167;</div>
                <div>Add water damage before/after photo</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Insurance + Public Adjuster */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Insurance Claims</div>
            <h2 className="sec-title">We Work With Your Insurance — And We Know Who Can Fight For You</h2>
            <p className="sec-sub">
              We document damage thoroughly from day one to support your claim. We&apos;ve worked
              alongside adjusters across New Jersey and know exactly what they need.
            </p>
          </div>
          <div className="home-split" style={{ alignItems: 'stretch' }}>
            <div className="home-split__text">
              <div className="sec-label sec-label--left">Our Role</div>
              <h3 style={{ fontSize: '1.5rem', marginBottom: 14 }}>Contractor Documentation</h3>
              <p style={{ marginBottom: 16 }}>
                From the moment we arrive on site, we document everything: photos, moisture
                readings, thermal imaging, and a detailed scope of work. This documentation
                becomes the backbone of your insurance claim. We know what adjusters need
                because we&apos;ve worked alongside them on hundreds of New Jersey jobs.
              </p>
              <ul className="coverage-list">
                {[
                  'Photographic documentation of all damage',
                  'Moisture mapping and drying logs',
                  'Scope of work aligned with insurance standards',
                  'Direct communication with your adjuster',
                  'Xactimate-compatible estimates available',
                ].map(item => (
                  <li key={item}><span className="coverage-list__check">&#10003;</span>{item}</li>
                ))}
              </ul>
            </div>
            <div className="home-split__img pa-partner-card" style={{ minHeight: 'unset' }}>
              <div className="pa-card">
                <div className="pa-card__label">Want More From Your Claim?</div>
                <div className="pa-card__name">Hire a Public Adjuster</div>
                <p className="pa-card__desc">
                  A public adjuster works <strong>exclusively for you</strong> — not your insurance
                  company. They review your policy, document losses, and negotiate directly with
                  the insurer to maximize your settlement. Most homeowners who use a public adjuster
                  receive significantly larger payouts than those who negotiate alone.
                </p>
                <p className="pa-card__desc" style={{ marginTop: 8 }}>
                  We refer our clients to{' '}
                  <a href="https://www.kozakadjusting.com" target="_blank" rel="noopener noreferrer" className="text-link">
                    Kozak Adjusting
                  </a>
                  , a trusted New Jersey public adjusting firm that has helped countless homeowners
                  maximize their insurance recovery.
                </p>
                <a
                  href="https://www.kozakadjusting.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-warm"
                  style={{ marginTop: 'auto', textAlign: 'center' }}
                >
                  Visit Kozak Adjusting ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Dealing with Water Damage Right Now?</h2>
        <p>Don&#39;t wait. Every hour matters. Call us for immediate response.</p>
        <div className="cta-banner__actions">
          <a href="tel:+19732194973" className="btn btn-warm">Call (973) 219-4973</a>
          <Link to="/contact" className="btn btn-outline-white">Send a Message</Link>
        </div>
      </section>
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'
import imgJobsite from '../assets/portfolio/kitchens/1-Aug 25 2025 09_50pm-WSRD.jpg'

const DropletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>
  </svg>
)
const FlameIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z"/>
  </svg>
)
const HammerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 12l-8.5 8.5a2.121 2.121 0 01-3-3L12 9"/>
    <path d="M17.64 15L22 10.64"/>
    <path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 00-3.94-1.64H9l.92.82A6.18 6.18 0 0112 8.4v1.56l2 2h2.47l2.26 1.91"/>
  </svg>
)
const ShieldCheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
)
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.82 19.79 19.79 0 012 1.18 2 2 0 014 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
  </svg>
)
const ChevronIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s' }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const PILLARS = [
  {
    icon: <DropletIcon />,
    title: 'Water Damage Restoration',
    desc: 'Emergency response, water extraction, structural drying, and mold prevention — then we rebuild everything back to better than before.',
    link: '/water-damage',
  },
  {
    icon: <FlameIcon />,
    title: 'Fire & Smoke Damage',
    desc: 'From smoke and soot removal to full structural restoration, we guide you through the entire recovery — insurance documentation included.',
    link: '/water-damage',
  },
  {
    icon: <HammerIcon />,
    title: 'Full Reconstruction',
    desc: 'We are a licensed NJ general contractor. Once the damage is remediated, we handle every trade — drywall, flooring, kitchens, baths, and more.',
    link: '/services',
  },
]

const PROCESS = [
  { step: '01', title: 'We Respond Fast', desc: 'Call us and we show up — same day for emergencies. We assess the damage, document everything, and start protecting your property immediately.' },
  { step: '02', title: 'We Restore It', desc: 'Certified water and fire mitigation: extraction, drying, smoke removal, antimicrobial treatment. We stop the damage and make it safe.' },
  { step: '03', title: 'We Rebuild It', desc: 'As a full NJ general contractor, we handle complete reconstruction — one company, one contract, from bare studs back to a finished home.' },
]

const CERTS = [
  { label: 'NJ Licensed GC', detail: 'NJ.LIC #13VH10509300' },
  { label: 'IICRC Certified', detail: 'Water & Fire · #70037130' },
  { label: 'EPA Lead Certified', detail: 'NAT-F293920-1' },
  { label: 'A-901 Certified', detail: 'NJDEP #0040532' },
]

const FAQS = [
  {
    q: 'How quickly can you respond to water damage in New Jersey?',
    a: 'We provide same-day emergency response throughout New Jersey. Water damage worsens by the hour — mold can begin growing within 24–48 hours of a moisture event. Call us at (973) 219-4973 and our team will be on-site as quickly as possible to begin extraction and drying.',
  },
  {
    q: 'Do you work directly with homeowners\' insurance companies?',
    a: 'Yes. We document damage thoroughly from day one — with photos, moisture readings, and detailed scope-of-work reports — to support your insurance claim. We have experience working alongside adjusters across New Jersey and know exactly what documentation they require to process a claim.',
  },
  {
    q: 'Should I hire a public adjuster for my insurance claim?',
    a: 'For larger claims — especially total losses, disputed settlements, or claims involving structural damage — a public adjuster can significantly increase your payout. A public adjuster works exclusively for you, not the insurance company. We partner with Kozak Adjusting (kozakadjusting.com), a trusted NJ public adjusting firm, for clients who want dedicated claim advocacy.',
  },
  {
    q: 'Are you licensed and insured in New Jersey?',
    a: 'Yes. Ukrainian Restoration LLC holds a New Jersey Home Improvement Contractor license (NJ.LIC #13VH10509300), IICRC certification for water and fire restoration (Firm #70037130), EPA Lead-Safe certification (NAT-F293920-1), and carries full general liability and workers\' compensation insurance on every job.',
  },
  {
    q: 'What is the difference between mitigation and reconstruction?',
    a: 'Mitigation stops the damage: water extraction, structural drying, smoke removal, and antimicrobial treatment. Reconstruction rebuilds what was removed or damaged: drywall, flooring, cabinetry, painting. Most contractors do only one or the other. Ukrainian Restoration handles both under one contract — saving you time, money, and the frustration of coordinating two companies.',
  },
  {
    q: 'What areas of New Jersey do you serve?',
    a: 'We serve Essex County, Bergen County, Hudson County, Passaic County, and surrounding areas — including Newark, Jersey City, Paterson, Elizabeth, Clifton, and Passaic. Not sure if we cover your location? Call us and we\'ll confirm.',
  },
]

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`faq-item${open ? ' faq-item--open' : ''}`} onClick={() => setOpen(o => !o)}>
      <div className="faq-item__q">
        <span>{q}</span>
        <ChevronIcon open={open} />
      </div>
      {open && <div className="faq-item__a">{a}</div>}
    </div>
  )
}

export default function Home() {
  useSEO({
    title: 'Ukrainian Restoration | Water & Fire Damage Restoration NJ | (973) 219-4973',
    description: 'Ukrainian Restoration LLC — IICRC-certified water damage restoration and licensed NJ general contractor. Emergency response, structural drying & full home reconstruction. NJ.LIC #13VH10509300.',
    canonical: '/',
    schema: FAQ_SCHEMA,
  })

  return (
    <>
      {/* ── Hero ── */}
      <section className="hero">
        <div className="container hero__split">
          <div className="hero__text">
            <div className="hero__label">Water · Fire · Reconstruction · New Jersey</div>
            <h1>
              Damage Restoration &amp;<br />
              <em>Complete Reconstruction</em>
            </h1>
            <p>
              Ukrainian Restoration LLC is a licensed New Jersey general contractor
              specializing in water and fire damage recovery. We don&apos;t just dry it out —
              we rebuild it, start to finish.
            </p>
            <div className="hero__actions">
              <a href="tel:+19732194973" className="btn btn-warm hero__call">
                <span className="hero__call-icon"><PhoneIcon /></span>
                (973) 219-4973
              </a>
              <Link to="/contact" className="btn btn-outline-white">Free Estimate</Link>
            </div>
            <div className="hero__trust">
              <span>IICRC Certified</span>
              <span className="hero__trust-dot" />
              <span>EPA Lead Certified</span>
              <span className="hero__trust-dot" />
              <span>NJ Licensed &amp; Insured</span>
            </div>
          </div>
          <div className="hero__visual">
            <img src="/Background_IIRCR.png" alt="Greg and Zach — Ukrainian Restoration founders, IICRC-certified restoration contractors in New Jersey" />
          </div>
        </div>
        <div className="hero__scroll">
          Scroll
          <div className="hero__scroll-line" />
        </div>
      </section>

      {/* ── Three core pillars ── */}
      <section className="section" aria-labelledby="pillars-heading">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Our Specialty</div>
            <h2 className="sec-title" id="pillars-heading">From Crisis to Completed Home</h2>
            <p className="sec-sub">
              Most contractors handle either the mitigation or the rebuild. We do both —
              under one roof, with one point of contact throughout New Jersey.
            </p>
          </div>
          <div className="pillars">
            {PILLARS.map(({ icon, title, desc, link }) => (
              <div className="pillar" key={title}>
                <div className="pillar__icon">{icon}</div>
                <h3 className="pillar__title">{title}</h3>
                <p className="pillar__desc">{desc}</p>
                <Link to={link} className="pillar__link">Learn more &rarr;</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The GC difference ── */}
      <section className="section section--alt" aria-labelledby="gc-diff-heading">
        <div className="container">
          <div className="home-split">
            <div className="home-split__img">
              <img src={imgJobsite} alt="Completed kitchen renovation by Ukrainian Restoration" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-lg)', display: 'block' }} />
            </div>
            <div className="home-split__text">
              <div className="sec-label sec-label--left">Why It Matters</div>
              <h2 id="gc-diff-heading">One Company. The Whole Job.</h2>
              <p>
                When your home suffers water or fire damage, most homeowners get bounced
                between a mitigation company and a separate contractor. That means two
                schedules, two contracts, and two sets of people who may not communicate.
              </p>
              <p>
                As a licensed New Jersey general contractor <em>and</em> IICRC-certified restoration firm,
                Ukrainian Restoration handles every phase — from the emergency call to the
                final coat of paint. You deal with one team, one timeline, and one bill.
              </p>
              <div className="split-features">
                <div className="split-feature">
                  <div className="split-feature__icon"><ShieldCheckIcon /></div>
                  <div>
                    <strong>Emergency to move-in ready</strong>
                    <p>We go from mitigation all the way through finished reconstruction.</p>
                  </div>
                </div>
                <div className="split-feature">
                  <div className="split-feature__icon"><ShieldCheckIcon /></div>
                  <div>
                    <strong>Insurance claim support</strong>
                    <p>We document everything from day one to support your claim with your adjuster.</p>
                  </div>
                </div>
                <div className="split-feature">
                  <div className="split-feature__icon"><ShieldCheckIcon /></div>
                  <div>
                    <strong>No subcontractor maze</strong>
                    <p>Our own crew handles the work — not a rotating cast of subs.</p>
                  </div>
                </div>
              </div>
              <div className="section-actions">
                <Link to="/about" className="btn btn-primary">About Our Team</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Process steps ── */}
      <section className="section" aria-labelledby="process-heading">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">How It Works</div>
            <h2 className="sec-title" id="process-heading">Respond. Restore. Rebuild.</h2>
            <p className="sec-sub">A clear process so you always know where things stand.</p>
          </div>
          <div className="process-steps">
            {PROCESS.map(({ step, title, desc }) => (
              <div className="process-step-home" key={step}>
                <div className="process-step-home__num">{step}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Public Adjuster Partner ── */}
      <section className="section section--alt" aria-labelledby="pa-heading">
        <div className="container">
          <div className="home-split">
            <div className="home-split__text">
              <div className="sec-label sec-label--left">Insurance Claim Advocacy</div>
              <h2 id="pa-heading">Need Someone to Fight for Your Claim?</h2>
              <p>
                A public adjuster works <strong>exclusively for you</strong> — not the insurance company.
                When your claim is undervalued, disputed, or denied, a licensed public adjuster
                negotiates on your behalf to maximize your settlement.
              </p>
              <p>
                We partner with{' '}
                <a
                  href="https://www.kozakadjusting.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link"
                >
                  Kozak Adjusting
                </a>
                , a trusted New Jersey public adjusting firm. Their team handles
                the insurance side — we handle the construction side. Together, you get
                the best possible outcome: maximum settlement and a finished home.
              </p>
              <div className="split-features" style={{ marginTop: 20 }}>
                <div className="split-feature">
                  <div className="split-feature__icon"><ShieldCheckIcon /></div>
                  <div>
                    <strong>Maximize your payout</strong>
                    <p>Public adjusters typically recover significantly more than homeowners negotiating alone.</p>
                  </div>
                </div>
                <div className="split-feature">
                  <div className="split-feature__icon"><ShieldCheckIcon /></div>
                  <div>
                    <strong>No upfront cost</strong>
                    <p>Public adjusters are paid a percentage of the final settlement — only when you get paid.</p>
                  </div>
                </div>
              </div>
              <div className="section-actions" style={{ gap: 12, flexWrap: 'wrap' }}>
                <a
                  href="https://www.kozakadjusting.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Visit Kozak Adjusting ↗
                </a>
                <Link to="/contact" className="btn btn-outline">Get a Free Estimate</Link>
              </div>
            </div>
            <div className="home-split__img pa-partner-card">
              <div className="pa-card">
                <div className="pa-card__label">Public Adjuster Partner</div>
                <div className="pa-card__name">Kozak Adjusting</div>
                <p className="pa-card__desc">
                  Licensed New Jersey public adjusters who negotiate insurance claims on
                  your behalf — so you get every dollar your policy entitles you to.
                </p>
                <a
                  href="https://www.kozakadjusting.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-warm"
                  style={{ width: '100%', textAlign: 'center', marginTop: 'auto' }}
                >
                  kozakadjusting.com ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── About ── */}
      <section className="section" aria-labelledby="story-heading">
        <div className="container">
          <div className="home-split home-split--reverse">
            <div className="home-split__text">
              <div className="sec-label sec-label--left">Our Story</div>
              <h2 id="story-heading">Built on Heritage &amp; Hard Work</h2>
              <p>
                Ukrainian Restoration was founded by brothers Greg and Zach — two software
                engineers who chose to build something real. They grew up learning construction
                from their grandfather and eventually turned that knowledge into a company
                rooted in the values of their Ukrainian heritage: honor, discipline, and pride
                in a job done right.
              </p>
              <p>
                The Kozak in our logo isn&apos;t just decoration. Strength, courage, and
                independence — that&apos;s how we show up to every job in New Jersey.
              </p>
              <div className="section-actions">
                <Link to="/about" className="btn btn-primary">Meet the Team</Link>
              </div>
            </div>
            <div className="home-split__img">
              <img src="/dido.JPG" alt="Ukrainian Restoration team" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-lg)', display: 'block' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Certifications ── */}
      <section className="section section--alt" aria-labelledby="certs-heading">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Credentials</div>
            <h2 className="sec-title" id="certs-heading">Licensed, Certified &amp; Bonded in New Jersey</h2>
            <p className="sec-sub">Every certification required to protect you, your property, and your insurance claim.</p>
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

      {/* ── FAQ ── */}
      <section className="section" aria-labelledby="faq-heading">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Common Questions</div>
            <h2 className="sec-title" id="faq-heading">Frequently Asked Questions</h2>
            <p className="sec-sub">Everything you need to know about water damage restoration and working with Ukrainian Restoration in New Jersey.</p>
          </div>
          <div className="faq-list">
            {FAQS.map(({ q, a }) => (
              <FaqItem key={q} q={q} a={a} />
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link to="/contact" className="btn btn-primary">Ask Us Anything</Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-banner">
        <h2>Dealing with Damage Right Now?</h2>
        <p>
          Don&apos;t wait — every hour matters with water and fire damage. Call us for
          an immediate response, or send a message for a free estimate on any project in New Jersey.
        </p>
        <div className="cta-banner__actions">
          <a href="tel:+19732194973" className="btn btn-warm">Call (973) 219-4973</a>
          <Link to="/contact" className="btn btn-outline-white">Send a Message</Link>
        </div>
      </section>
    </>
  )
}

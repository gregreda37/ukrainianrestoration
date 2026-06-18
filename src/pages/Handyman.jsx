import { Link } from 'react-router-dom'

const SERVICES = [
  'Furniture assembly',
  'TV and shelf mounting',
  'Door and lock repairs',
  'Window screen replacement',
  'Caulking and weatherstripping',
  'Minor drywall repairs and patching',
  'Fixture installation (lights, fans, faucets)',
  'Cabinet hardware and hinges',
  'Gutter cleaning and minor repairs',
  'Deck and fence repairs',
  'Tile re-grouting and caulking',
  'Anything else on the to-do list',
]

const PAYMENT = [
  { label: 'Standard jobs', detail: 'Payment due upon completion.' },
  { label: 'Multi-day projects', detail: 'Invoiced at the end of each day — labor and materials itemized.' },
  { label: 'Large projects', detail: '50% deposit upfront, balance due at completion.' },
]

export default function Handyman() {
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Handyman Services</h1>
          <p>Flat $90/hr rate. Transparent invoicing. No job too small.</p>
        </div>
      </div>

      {/* Pricing callout */}
      <section className="section">
        <div className="container">
          <div className="grid-2">
            <div>
              <div className="sec-label">Pricing</div>
              <h2>Simple, Honest Rates</h2>
              <div className="rate-card card">
                <div className="rate-card__rate">$90<span>/hr</span></div>
                <p className="rate-card__note">2-hour minimum per visit</p>
                <p className="rate-card__detail">
                  You can supply your own materials for assembly and installation jobs,
                  or we can procure them. Time spent sourcing materials is billed at the
                  standard hourly rate.
                </p>
              </div>

              <div className="section-actions">
                <div className="sec-label">Payment Terms</div>
              </div>
              <div className="payment-terms">
                {PAYMENT.map(({ label, detail }) => (
                  <div className="payment-term" key={label}>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                ))}
              </div>

              <div className="section-actions">
                <a href="tel:+19732194973" className="btn btn-warm">Book a Visit</a>
              </div>
            </div>

            <div>
              <div className="sec-label">Common Jobs</div>
              <h2>What We Handle</h2>
              <ul className="handyman-list">
                {SERVICES.map(item => (
                  <li key={item}>
                    <span className="handyman-list__check">&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="section section--alt">
        <div className="container">
          <div className="grid-3">
            {[
              { title: 'Itemized Invoices', desc: 'Every invoice details labor, materials, and any additional services. No guessing.' },
              { title: 'Licensed & Insured', desc: 'NJ.LIC #13VH10509300 · Fully insured and bonded on every job, no matter the size.' },
              { title: 'Flexible Scheduling', desc: 'We work around your schedule. Evenings and weekends available for most jobs.' },
            ].map(({ title, desc }) => (
              <div className="card info-card" key={title}>
                <h3 className="info-card__title">{title}</h3>
                <p className="info-card__body">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Got a To-Do List?</h2>
        <p>Call us and we&#39;ll knock it out. $90/hr, 2-hour minimum, no hidden fees.</p>
        <div className="cta-banner__actions">
          <a href="tel:+19732194973" className="btn btn-warm">Call (973) 219-4973</a>
          <Link to="/contact" className="btn btn-outline-white">Send a Message</Link>
        </div>
      </section>
    </>
  )
}

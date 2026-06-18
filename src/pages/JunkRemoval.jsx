import { Link } from 'react-router-dom'

const LOADS = [
  { vehicle: 'Truck Bed Load', price: '$325', desc: 'Perfect for a single room cleanout, small appliances, or a handful of furniture pieces.' },
  { vehicle: 'Small Trailer', size: "6' × 10'", price: '$550', desc: 'Good for a full room or garage cleanout, or a medium-sized renovation debris haul.' },
  { vehicle: 'Medium Trailer', size: "7' × 14'", price: '$875', desc: 'Ideal for whole-home cleanouts, large renovation projects, or estate cleanouts.' },
]

const STANDARD = [
  'Household furniture',
  'Mattresses and box springs',
  'Small appliances',
  'General household debris',
  'Post-construction waste',
  'Yard debris and clutter',
]

const VARIABLE = [
  'Heavy materials (soil, concrete, roofing)',
  'Large appliances (fridge, washer/dryer)',
  'Hazardous materials',
  'Electronics (e-waste fees may apply)',
]

export default function JunkRemoval() {
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Junk Removal</h1>
          <p>Fast, reliable removal starting at $325. Pricing includes loading, transport, and proper disposal.</p>
        </div>
      </div>

      {/* Pricing */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Transparent Pricing</div>
            <h2 className="sec-title">Bill by Load, Not by Item</h2>
            <p className="sec-sub">
              We charge based on vehicle capacity — not by the piece. Price includes loading,
              transportation, and disposal. No surprise fees.
            </p>
          </div>
          <div className="grid-3">
            {LOADS.map(({ vehicle, size, price, desc }) => (
              <div className="card load-card" key={vehicle}>
                <div className="load-card__price">{price}</div>
                <h3 className="load-card__vehicle">{vehicle}</h3>
                {size && <div className="load-card__size">{size}</div>}
                <p>{desc}</p>
              </div>
            ))}
          </div>
          <p className="cta-note">
            Prices include loading, transportation, and disposal. Variable-rate items quoted before service begins.
          </p>
        </div>
      </section>

      {/* What's included */}
      <section className="section section--alt">
        <div className="container">
          <div className="grid-2">
            <div className="coverage-section">
              <div className="sec-label">Standard Rate Items</div>
              <h3>Covered in Base Price</h3>
              <ul className="coverage-list">
                {STANDARD.map(item => (
                  <li key={item}><span className="coverage-list__check">&#10003;</span>{item}</li>
                ))}
              </ul>
            </div>
            <div className="coverage-section">
              <div className="sec-label">Variable Rate Items</div>
              <h3>Quoted Before Pickup</h3>
              <ul className="coverage-list coverage-list--neutral">
                {VARIABLE.map(item => (
                  <li key={item}><span className="coverage-list__check coverage-list__check--neutral">&#9679;</span>{item}</li>
                ))}
              </ul>
              <p className="coverage-note">
                We&#39;ll always give you a firm price for these items before we start — no surprises.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Responsible disposal */}
      <section className="section">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Responsible Disposal</div>
            <h2 className="sec-title">NJDEP-Licensed &amp; A-901 Certified</h2>
            <p className="sec-sub">
              We&#39;re an A-901 Certified Dumping Firm (NJDEP #0040532), meaning all materials go
              to state-approved facilities. Recyclables — metal, wood, concrete — are diverted from
              landfills whenever possible.
            </p>
          </div>
          <div className="grid-3">
            {[
              { title: 'State-Approved Facilities', desc: 'Every load is taken to NJDEP-licensed transfer stations. We never dump illegally.' },
              { title: 'Recycling First', desc: 'Metal, wood, and concrete are sorted and sent to recycling partners instead of the landfill.' },
              { title: 'Full Documentation', desc: 'We can provide disposal receipts for your records — useful for commercial and estate cleanouts.' },
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
        <h2>Ready to Clear It Out?</h2>
        <p>Call us or send a message to schedule a pickup. We move fast.</p>
        <div className="cta-banner__actions">
          <a href="tel:+19732194973" className="btn btn-warm">Call (973) 219-4973</a>
          <Link to="/contact" className="btn btn-outline-white">Get a Quote</Link>
        </div>
      </section>
    </>
  )
}

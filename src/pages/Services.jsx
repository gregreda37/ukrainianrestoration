import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'
import imgKitchen   from '../assets/portfolio/kitchens/2-Aug 27 2025 05_54pm-ZYZx.jpg'
import imgBath      from '../assets/portfolio/bathrooms/1-Dec 02 2024 02_10pm-KQAb.jpg'
import imgRenovation from '../assets/portfolio/painting-drywall/4-Nov 26 2025 04_51pm-Tgnu.jpg'
import imgBasement  from '../assets/portfolio/painting-drywall/3-Jun 06 2025 04_33pm-3DFb.jpg'
import imgPainting  from '../assets/portfolio/painting-drywall/2-Nov 19 2025 04_01pm-5Vw5.jpg'
import imgFlooring  from '../assets/portfolio/bathrooms/13-Jan 16 2025 09_27pm-tyos.jpg'

const SERVICES = [
  {
    title: 'Kitchen Remodeling',
    desc: 'Your kitchen is the heart of your home — let us make it shine. From a fresh update to a full redesign, we handle it all.',
    items: ['Custom cabinetry & islands', 'Countertop installation', 'Tile backsplash', 'Appliance integration', 'Lighting & electrical'],
    color: '#8B5E3C',
    photo: imgKitchen,
  },
  {
    title: 'Bathroom Renovation',
    desc: 'We transform ordinary bathrooms into personal retreats, with attention to every tile, fixture, and finish.',
    items: ['Walk-in showers & tubs', 'Vanity & fixture replacement', 'Tile work & waterproofing', 'Heated floors', 'Plumbing upgrades'],
    color: '#5C8A7A',
    photo: imgBath,
  },
  {
    title: 'Full Home Renovation',
    desc: 'Planning a complete overhaul? We manage the whole project — so you only have one call to make.',
    items: ['Open floor plan conversions', 'Structural modifications', 'Room additions', 'Multi-trade coordination', 'Design consultation'],
    color: '#7A5C8A',
    photo: imgRenovation,
  },
  {
    title: 'Basement Finishing',
    desc: 'Turn your unfinished basement into usable living space — a home office, gym, rec room, or guest suite.',
    items: ['Framing & insulation', 'Drywall & painting', 'Flooring installation', 'Egress windows', 'Bar & entertainment areas'],
    color: '#8A7A5C',
    photo: imgBasement,
  },
  {
    title: 'Interior Painting',
    desc: 'A fresh coat of paint is one of the highest-ROI improvements you can make. We prep, prime, and paint with precision.',
    items: ['Wall & ceiling painting', 'Trim & door painting', 'Textured finishes', 'Color consultation', 'Prep & patch work'],
    color: '#5C7A8A',
    photo: imgPainting,
  },
  {
    title: 'Flooring Installation',
    desc: 'From hardwood to tile to luxury vinyl, we install flooring that looks great and lasts for decades.',
    items: ['Hardwood & engineered wood', 'Tile & natural stone', 'Luxury vinyl plank', 'Carpet installation', 'Subfloor repair'],
    color: '#8A5C5C',
    photo: imgFlooring,
  },
]

export default function Services() {
  useSEO({
    title: 'Services | Kitchen, Bathroom, Basement & Home Renovation NJ — Ukrainian Restoration',
    description: 'Licensed NJ general contractor offering kitchen remodeling, bathroom renovation, basement finishing, flooring, and full home reconstruction. NJ.LIC #13VH10509300.',
    canonical: '/services',
  })
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Our Services</h1>
          <p>From a single room refresh to a whole-home transformation — we have the expertise to do it right.</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="services-grid">
            {SERVICES.map(({ title, desc, items, photo }) => (
              <div className="card service-card" key={title}>
                <img
                  src={photo}
                  alt={title}
                  style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 'var(--r) var(--r) 0 0', display: 'block' }}
                />
                <div className="service-card__body">
                  <h3>{title}</h3>
                  <p>{desc}</p>
                  <ul className="service-card__list">
                    {items.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section className="section section--alt">
        <div className="container">
          <div className="sec-hd">
            <div className="sec-label">Why Choose Us</div>
            <h2 className="sec-title">The Ukrainian Restoration Difference</h2>
          </div>
          <div className="grid-3">
            {[
              { title: 'Single Point of Contact', desc: 'You work with one person from estimate to final walk-through. No runaround, no confusion.' },
              { title: 'Transparent Pricing', desc: 'We give you a detailed, itemized quote upfront. What we quote is what you pay.' },
              { title: 'Licensed & Insured', desc: 'Fully licensed in New Jersey (NJ.LIC #13VH10509300) with general liability and workers\' comp coverage on every job.' },
            ].map(({ title, desc }) => (
              <div className="card" key={title} style={{ padding: '32px' }}>
                <h3 style={{ marginBottom: 12, fontSize: '1.1875rem' }}>{title}</h3>
                <p style={{ color: 'var(--clr-text-lt)', fontSize: '.9375rem' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Not Sure Where to Start?</h2>
        <p>We&#39;ll come out, assess your space, and give you an honest recommendation — no pressure, no obligation.</p>
        <div className="cta-banner__actions">
          <Link to="/contact" className="btn btn-accent">Schedule a Consultation</Link>
          <Link to="/gallery" className="btn btn-outline-white">See Our Work</Link>
        </div>
      </section>
    </>
  )
}

import { useState } from 'react'
import imgKitchen1  from '../assets/portfolio/kitchens/1-Aug 25 2025 09_50pm-WSRD.jpg'
import imgKitchen2  from '../assets/portfolio/kitchens/2-Aug 27 2025 05_54pm-ZYZx.jpg'
import imgKitchen3  from '../assets/portfolio/kitchens/6-Jul 09 2025 08_33pm-ZF7G.jpg'
import imgKitchen4  from '../assets/portfolio/kitchens/2-Jan 15 2026 07_40pm-rBqe.jpg'
import imgBath1     from '../assets/portfolio/bathrooms/1-Dec 02 2024 02_10pm-KQAb.jpg'
import imgBath2     from '../assets/portfolio/bathrooms/2-Jan 27 2025 02_11pm-k6B6.jpg'
import imgBath3     from '../assets/portfolio/bathrooms/3-Dec 17 2024 11_17pm-oVGL.jpg'
import imgBath4     from '../assets/portfolio/bathrooms/a037fdf9-f361-4d39-86a0-0aff9f8dbfdb.JPG'
import imgPaint1    from '../assets/portfolio/painting-drywall/1-Mar 20 2025 04_33pm-52Ee.jpg'
import imgPaint2    from '../assets/portfolio/painting-drywall/3-Jun 06 2025 04_33pm-3DFb.jpg'
import imgExt1      from '../assets/portfolio/decks-exterior/IMG_0054-0001.jpeg'
import imgExt2      from '../assets/portfolio/decks-exterior/IMG_2056.jpg'

const CATEGORIES = ['All', 'Kitchen', 'Bathroom', 'Painting & Drywall', 'Exterior']

const PHOTOS = [
  { id: 1,  src: imgKitchen1, category: 'Kitchen',           label: 'Kitchen Remodel — Montclair, NJ',     featured: true },
  { id: 2,  src: imgBath1,    category: 'Bathroom',          label: 'Master Bath Renovation — Bloomfield, NJ' },
  { id: 3,  src: imgKitchen2, category: 'Kitchen',           label: 'Kitchen Renovation — Livingston, NJ' },
  { id: 4,  src: imgBath2,    category: 'Bathroom',          label: 'Bathroom Remodel — Glen Ridge, NJ' },
  { id: 5,  src: imgPaint1,   category: 'Painting & Drywall', label: 'Interior Painting — Montclair, NJ' },
  { id: 6,  src: imgKitchen3, category: 'Kitchen',           label: 'Kitchen Update — Verona, NJ' },
  { id: 7,  src: imgExt1,     category: 'Exterior',          label: 'Exterior Work — Bloomfield, NJ' },
  { id: 8,  src: imgBath3,    category: 'Bathroom',          label: 'Guest Bath — Cedar Grove, NJ' },
  { id: 9,  src: imgKitchen4, category: 'Kitchen',           label: 'Kitchen Refresh — Nutley, NJ' },
  { id: 10, src: imgPaint2,   category: 'Painting & Drywall', label: 'Drywall & Finish — Verona, NJ' },
  { id: 11, src: imgBath4,    category: 'Bathroom',          label: 'Full Bath Remodel — West Orange, NJ' },
  { id: 12, src: imgExt2,     category: 'Exterior',          label: 'Deck & Exterior — Livingston, NJ' },
]

export default function Gallery() {
  const [activeFilter, setActiveFilter] = useState('All')

  const visible = activeFilter === 'All'
    ? PHOTOS
    : PHOTOS.filter(p => p.category === activeFilter)

  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Our Work</h1>
          <p>Browse completed projects across kitchens, bathrooms, renovations, and more.</p>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="gallery-filters">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`filter-btn${activeFilter === cat ? ' active' : ''}`}
                onClick={() => setActiveFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--clr-text-lt)', padding: '48px 0' }}>
              No photos in this category yet.
            </p>
          ) : (
            <div className="gallery-grid">
              {visible.map((photo, i) => (
                <div
                  key={photo.id}
                  className={`gallery-item${i === 0 && activeFilter === 'All' ? ' gallery-item--featured' : ''}`}
                >
                  <img
                    src={photo.src}
                    alt={photo.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <div className="gallery-item__overlay">
                    <span>{photo.label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

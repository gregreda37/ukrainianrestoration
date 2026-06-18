import { useState } from 'react'

const CATEGORIES = ['All', 'Kitchen', 'Bathroom', 'Renovation', 'Basement', 'Exterior']

const PHOTOS = [
  { id: 1, category: 'Kitchen', label: 'Kitchen Remodel — Lincoln Park', featured: true },
  { id: 2, category: 'Bathroom', label: 'Master Bath Renovation — Naperville' },
  { id: 3, category: 'Kitchen', label: 'Open Kitchen — Oak Park' },
  { id: 4, category: 'Renovation', label: 'Full Home Renovation — Evanston' },
  { id: 5, category: 'Basement', label: 'Basement Finishing — Schaumburg' },
  { id: 6, category: 'Bathroom', label: 'Guest Bath — River North' },
  { id: 7, category: 'Exterior', label: 'Exterior Refresh — Wicker Park' },
  { id: 8, category: 'Kitchen', label: 'Kitchen Update — Lakeview' },
  { id: 9, category: 'Renovation', label: 'Condo Renovation — Gold Coast' },
]

const CATEGORY_COLORS = {
  Kitchen: '#8B5E3C',
  Bathroom: '#5C8A7A',
  Renovation: '#7A5C8A',
  Basement: '#8A7A5C',
  Exterior: '#5C7A8A',
}

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
              {visible.map((photo, i) => {
                const color = CATEGORY_COLORS[photo.category] || '#8B5E3C'
                return (
                  <div
                    key={photo.id}
                    className={`gallery-item${i === 0 && activeFilter === 'All' ? ' gallery-item--featured' : ''}`}
                  >
                    <div
                      className="img-ph"
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 0,
                        background: `linear-gradient(135deg, ${color}22 0%, ${color}55 100%)`,
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: '2.5rem', opacity: .35 }}>&#127968;</div>
                      <div style={{ fontSize: '.8125rem' }}>Add photo</div>
                    </div>
                    <div className="gallery-item__overlay">
                      <span>{photo.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 56, padding: '32px', background: 'var(--clr-bg-alt)', borderRadius: 'var(--r-lg)' }}>
            <p style={{ color: 'var(--clr-text-lt)', marginBottom: 16 }}>
              Ready to add your own project photos? Replace the placeholders in <code>src/pages/Gallery.jsx</code> with real images.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}

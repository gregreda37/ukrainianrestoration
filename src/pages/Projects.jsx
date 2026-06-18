import { useState, useCallback } from 'react'
import { PHOTOS, CATEGORIES } from '../data/portfolio'

const CATEGORY_COLORS = {
  Kitchens:            '#8B5E3C',
  Bathrooms:           '#5C8A7A',
  'Painting & Drywall': '#7A6B8A',
  'Decks & Exterior':  '#5C7A5C',
  'Tiny Homes':        '#8A7A5C',
  'Water Damage':      '#5C7A8A',
}

function EmptyCategory({ category }) {
  return (
    <div className="portfolio-empty">
      <div className="portfolio-empty__icon">&#128247;</div>
      <p>
        Drop photos into <code>src/assets/portfolio/{category.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}/</code> and rebuild.
      </p>
    </div>
  )
}

export default function Projects() {
  const [activeFilter, setActiveFilter] = useState('All')
  const [portraits, setPortraits] = useState({})

  const handleLoad = useCallback((e, src) => {
    const { naturalWidth, naturalHeight } = e.target
    if (naturalHeight > naturalWidth) {
      setPortraits(prev => ({ ...prev, [src]: true }))
    }
  }, [])

  const visible = activeFilter === 'All'
    ? PHOTOS
    : PHOTOS.filter(p => p.category === activeFilter)

  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Our Projects</h1>
          <p>Kitchen renovations, bathroom remodels, water damage recoveries, and everything in between.</p>
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
            activeFilter === 'All' ? (
              /* No photos yet at all — show folder map */
              <div className="portfolio-setup">
                <h3>Add Your Portfolio Photos</h3>
                <p>
                  Your photo folders are ready. Here&#39;s how to populate them:
                </p>
                <ol className="portfolio-setup__steps">
                  <li>
                    Drop image files into the matching folder under <code>public/portfolio/</code>
                  </li>
                  <li>
                    Open <code>src/data/portfolio.js</code> and add one entry per photo
                  </li>
                  <li>Save — Vite hot-reloads instantly in dev mode</li>
                </ol>
                <div className="portfolio-folders">
                  {CATEGORIES.filter(c => c !== 'All').map(cat => (
                    <div className="portfolio-folder" key={cat}>
                      <div
                        className="portfolio-folder__swatch"
                        style={{ background: `${CATEGORY_COLORS[cat]}33`, borderColor: `${CATEGORY_COLORS[cat]}55` }}
                      />
                      <div>
                        <strong>{cat}</strong>
                        <code>public/portfolio/{cat.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}/</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyCategory category={activeFilter} />
            )
          ) : (
            <div className="gallery-grid">
              {visible.map((photo) => (
                <div
                  key={photo.src}
                  className={`gallery-item${portraits[photo.src] ? ' gallery-item--portrait' : ''}`}
                >
                  <img
                    src={photo.src}
                    alt={photo.label}
                    loading="lazy"
                    onLoad={(e) => handleLoad(e, photo.src)}
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

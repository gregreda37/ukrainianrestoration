import { useEffect } from 'react'

const BASE = 'https://www.ukrainianrestoration.com'

export function useSEO({ title, description, canonical, schema }) {
  useEffect(() => {
    if (title) document.title = title

    const setMeta = (selector, attr, value) => {
      let el = document.querySelector(selector)
      if (el && value) el.setAttribute(attr, value)
    }

    setMeta('meta[name="description"]',         'content', description)
    setMeta('meta[property="og:title"]',         'content', title)
    setMeta('meta[property="og:description"]',   'content', description)
    setMeta('meta[property="twitter:title"]',    'content', title)
    setMeta('meta[property="twitter:description"]', 'content', description)

    if (canonical) {
      setMeta('link[rel="canonical"]', 'href', `${BASE}${canonical}`)
      setMeta('meta[property="og:url"]', 'content', `${BASE}${canonical}`)
    }

    // Inject page-specific JSON-LD schema
    let schemaEl = null
    if (schema) {
      schemaEl = document.createElement('script')
      schemaEl.type = 'application/ld+json'
      schemaEl.id = 'page-schema'
      schemaEl.text = JSON.stringify(schema)
      document.getElementById('page-schema')?.remove()
      document.head.appendChild(schemaEl)
    }

    return () => {
      schemaEl?.remove()
    }
  }, [title, description, canonical, schema])
}

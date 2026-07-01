import { useState, useEffect, useRef } from 'react'

export default function InsurerCombobox({ value, onChange, insurers = [], className = '', placeholder = 'Search insurer…', inputStyle = {} }) {
  const [query,  setQuery]  = useState(value || '')
  const [open,   setOpen]   = useState(false)
  const containerRef = useRef(null)

  // Keep input in sync when parent resets the value
  useEffect(() => { setQuery(value || '') }, [value])

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const filtered = query.length === 0
    ? insurers
    : insurers.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))

  function select(name) {
    setQuery(name)
    onChange(name)
    setOpen(false)
  }

  function handleChange(e) {
    setQuery(e.target.value)
    onChange(e.target.value)
    setOpen(true)
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); e.target.blur() }
    if (e.key === 'Enter' && filtered.length > 0) { select(filtered[0].name); e.preventDefault() }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        className={className}
        style={inputStyle}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 10,
          boxShadow: '0 6px 24px rgba(15,23,42,.12)', maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.map(i => (
            <div key={i.id}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13.5, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}
              onMouseDown={e => { e.preventDefault(); select(i.name) }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              {i.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

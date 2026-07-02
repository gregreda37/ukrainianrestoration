import { useState, useEffect, useRef } from 'react'

export default function InsurerCombobox({
  value, onChange, insurers = [],
  className = '', placeholder = 'Search insurer…', inputStyle = {},
  onAdd,    // async (name: string) => void
  onRemove, // async ({id, name}) => void
}) {
  const [query,      setQuery]      = useState(value || '')
  const [open,       setOpen]       = useState(false)
  const [adding,     setAdding]     = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const trimmed  = query.trim()
  const filtered = trimmed.length === 0
    ? insurers
    : insurers.filter(i => i.name.toLowerCase().includes(trimmed.toLowerCase()))
  const exactMatch  = insurers.some(i => i.name.toLowerCase() === trimmed.toLowerCase())
  const showAddRow  = onAdd && trimmed.length > 0 && !exactMatch
  const showDropdown = open && (filtered.length > 0 || showAddRow)

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
    if (e.key === 'Enter' && filtered.length === 0 && showAddRow) { handleAdd(); e.preventDefault() }
  }

  async function handleAdd() {
    if (!onAdd || !trimmed || adding) return
    setAdding(true)
    try { await onAdd(trimmed); select(trimmed) } finally { setAdding(false) }
  }

  async function handleRemove(e, insurer) {
    e.stopPropagation()
    if (!onRemove || removingId) return
    setRemovingId(insurer.id)
    try { await onRemove(insurer) } finally { setRemovingId(null) }
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
      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 10,
          boxShadow: '0 6px 24px rgba(15,23,42,.12)', maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.map(i => (
            <div key={i.id} style={{
              display: 'flex', alignItems: 'center',
              padding: '9px 14px', cursor: 'pointer',
              fontSize: 13.5, color: '#0f172a', borderBottom: '1px solid #f1f5f9',
            }}
              onMouseDown={e => { e.preventDefault(); select(i.name) }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              <span style={{ flex: 1 }}>{i.name}</span>
              {onRemove && (
                <button
                  type="button"
                  style={{
                    background: 'none', border: 'none', cursor: removingId === i.id ? 'default' : 'pointer',
                    color: '#94a3b8', padding: '2px 6px', borderRadius: 4,
                    fontSize: 15, lineHeight: 1, flexShrink: 0,
                    opacity: removingId === i.id ? 0.4 : 1,
                  }}
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); handleRemove(e, i) }}
                  onMouseEnter={e => { if (removingId !== i.id) e.currentTarget.style.color = '#dc2626' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8' }}
                  title="Remove from list"
                  disabled={!!removingId}
                >
                  {removingId === i.id ? '…' : '×'}
                </button>
              )}
            </div>
          ))}
          {showAddRow && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 14px', cursor: adding ? 'default' : 'pointer',
              fontSize: 13.5, color: '#2563eb',
              borderTop: filtered.length > 0 ? '1px solid #e2e8f0' : 'none',
              fontWeight: 500,
            }}
              onMouseDown={e => { e.preventDefault(); handleAdd() }}
              onMouseEnter={e => { if (!adding) e.currentTarget.style.background = '#eff6ff' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              {adding ? '…' : '＋'} Add "{trimmed}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

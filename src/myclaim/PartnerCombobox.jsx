import { useState, useEffect, useRef } from 'react'

/**
 * Partner selection combobox.
 * onSelect({id, name}) — called when a partner is chosen
 * onClear()            — called when "No partner" is chosen
 * onAdd(name)          — async, should create the partner and return {id, name}
 * onRemove({id, name}) — async, should delete the partner from Firestore
 */
export default function PartnerCombobox({
  selectedId = '',
  selectedName = '',
  partners = [],
  onSelect,
  onClear,
  onAdd,
  onRemove,
  className = '',
  placeholder = 'Search partner…',
}) {
  const [query,      setQuery]      = useState(selectedName || '')
  const [open,       setOpen]       = useState(false)
  const [adding,     setAdding]     = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const containerRef = useRef(null)

  // Sync query when parent resets the selection
  useEffect(() => { setQuery(selectedName || '') }, [selectedName])

  useEffect(() => {
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        // If user typed something that doesn't match selection, revert
        setQuery(selectedName || '')
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [selectedName])

  const trimmed  = query.trim()
  const filtered = trimmed.length === 0
    ? partners
    : partners.filter(p => p.name.toLowerCase().includes(trimmed.toLowerCase()))
  const exactMatch  = partners.some(p => p.name.toLowerCase() === trimmed.toLowerCase())
  const showAddRow  = onAdd && trimmed.length > 0 && !exactMatch
  const showDropdown = open && (filtered.length > 0 || showAddRow || selectedId)

  function pick(partner) {
    setQuery(partner.name)
    onSelect?.(partner)
    setOpen(false)
  }

  function clear() {
    setQuery('')
    onClear?.()
    setOpen(false)
  }

  function handleChange(e) {
    setQuery(e.target.value)
    setOpen(true)
    // If the field is cleared, propagate clear
    if (!e.target.value && selectedId) onClear?.()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setQuery(selectedName || ''); setOpen(false); e.target.blur() }
    if (e.key === 'Enter' && filtered.length > 0) { pick(filtered[0]); e.preventDefault() }
    if (e.key === 'Enter' && filtered.length === 0 && showAddRow) { handleAdd(); e.preventDefault() }
  }

  async function handleAdd() {
    if (!onAdd || !trimmed || adding) return
    setAdding(true)
    try {
      const partner = await onAdd(trimmed)
      if (partner) pick(partner)
    } finally { setAdding(false) }
  }

  async function handleRemove(e, partner) {
    e.stopPropagation()
    if (!onRemove || removingId) return
    setRemovingId(partner.id)
    try {
      await onRemove(partner)
      if (partner.id === selectedId) clear()
    } finally { setRemovingId(null) }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        className={className}
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
          {/* "No partner" clear option — only show when a partner is currently selected */}
          {selectedId && (
            <div style={{
              padding: '9px 14px', cursor: 'pointer',
              fontSize: 13.5, color: '#94a3b8', borderBottom: '1px solid #f1f5f9',
              fontStyle: 'italic',
            }}
              onMouseDown={e => { e.preventDefault(); clear() }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              — No partner
            </div>
          )}

          {filtered.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center',
              padding: '9px 14px', cursor: 'pointer',
              fontSize: 13.5, color: '#0f172a', borderBottom: '1px solid #f1f5f9',
              background: p.id === selectedId ? '#eff6ff' : '',
            }}
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={e => { if (p.id !== selectedId) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = p.id === selectedId ? '#eff6ff' : '' }}
            >
              <span style={{ flex: 1, fontWeight: p.id === selectedId ? 600 : 400 }}>{p.name}</span>
              {onRemove && (
                <button
                  type="button"
                  style={{
                    background: 'none', border: 'none', cursor: removingId === p.id ? 'default' : 'pointer',
                    color: '#94a3b8', padding: '2px 6px', borderRadius: 4,
                    fontSize: 15, lineHeight: 1, flexShrink: 0,
                    opacity: removingId === p.id ? 0.4 : 1,
                  }}
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); handleRemove(e, p) }}
                  onMouseEnter={e => { if (removingId !== p.id) e.currentTarget.style.color = '#dc2626' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8' }}
                  title="Remove from list"
                  disabled={!!removingId}
                >
                  {removingId === p.id ? '…' : '×'}
                </button>
              )}
            </div>
          ))}

          {showAddRow && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 14px', cursor: adding ? 'default' : 'pointer',
              fontSize: 13.5, color: '#2563eb',
              borderTop: filtered.length > 0 || selectedId ? '1px solid #e2e8f0' : 'none',
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

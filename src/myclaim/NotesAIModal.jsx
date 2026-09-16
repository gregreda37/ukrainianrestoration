import { useState, useEffect, useRef } from 'react'
import { auth } from '../firebase'
import './NotesAIModal.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

export default function NotesAIModal({ clientName, companyName, lineItems, isEstimate, onSelect, onClose }) {
  const [streaming, setStreaming] = useState(false)
  const [rawText,   setRawText]   = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [done,  setDone]  = useState(false)
  const [error, setError] = useState('')
  const readerRef   = useRef(null)
  const streamBoxRef = useRef(null)

  useEffect(() => { generate() }, [])

  useEffect(() => {
    if (streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight
    }
  }, [rawText])

  async function generate() {
    if (readerRef.current) { try { readerRef.current.cancel() } catch {} }
    setStreaming(true)
    setError('')
    setRawText('')
    setSuggestions([])
    setDone(false)

    try {
      const idToken = await auth.currentUser?.getIdToken()
      const subtotal = lineItems.reduce((s, it) =>
        s + (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0), 0)

      const resp = await fetch(`${BACKEND}/ai/suggest-notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          docType: isEstimate ? 'estimate' : 'invoice',
          clientName,
          companyName,
          lineItems,
          subtotal,
        }),
      })

      if (!resp.ok) throw new Error(`Server error ${resp.status}`)

      const reader = resp.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') {
            setSuggestions(parseSuggestions(accumulated))
            setDone(true)
            setStreaming(false)
            return
          }
          try {
            const { text, error: e } = JSON.parse(payload)
            if (e) { setError(e); setStreaming(false); return }
            if (text) { accumulated += text; setRawText(accumulated) }
          } catch {}
        }
      }
    } catch (e) {
      setError(e.message)
      setStreaming(false)
    }
  }

  function parseSuggestions(text) {
    const results = []
    const re = /SUGGESTION_(\d)\n([\s\S]*?)END_SUGGESTION_\1/g
    let m
    while ((m = re.exec(text)) !== null) results.push(m[2].trim())
    return results
  }

  return (
    <div className="naim-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="naim-modal">

        <div className="naim-header">
          <span className="naim-title">✨ AI Notes Suggestions</span>
          <button className="naim-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="naim-error">{error}<button className="naim-retry-link" onClick={generate}>Try again</button></div>}

        {!done && !error && (
          <div className="naim-thinking-wrap">
            <div className="naim-thinking-label">
              <span className="naim-pulse" />
              {streaming ? 'Generating suggestions…' : 'Starting…'}
            </div>
            <div className="naim-stream-box" ref={streamBoxRef}>{rawText}</div>
          </div>
        )}

        {done && suggestions.length > 0 && (
          <div className="naim-suggestions">
            {suggestions.map((s, i) => (
              <div key={i} className="naim-card">
                <div className="naim-card-label">Option {i + 1}</div>
                <p className="naim-card-text">{s}</p>
                <button className="naim-use-btn" onClick={() => onSelect(s)}>
                  Use this ↗
                </button>
              </div>
            ))}
          </div>
        )}

        {done && suggestions.length === 0 && !error && (
          <div className="naim-error">Couldn't parse suggestions — <button className="naim-retry-link" onClick={generate}>try again</button></div>
        )}

        {done && (
          <div className="naim-footer">
            <button className="naim-regen-btn" onClick={generate}>↺ Regenerate</button>
          </div>
        )}

      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import { api } from './api'

export default function Documents() {
  const { user } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    async function load() {
      try {
        const snap = await getDocs(collection(db, 'users', user.uid, 'documents'))
        setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  async function handleProcess(e) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setProcessing(true)
    try {
      const result = await api.claimChatbot.processDocument({
        uid: user.uid,
        fileUrl: url.trim(),
        docId: Date.now().toString(),
      })
      const newDoc = {
        fileUrl: url.trim(),
        summary: result.summary,
        processedAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'users', user.uid, 'documents'), {
        ...newDoc,
        createdAt: serverTimestamp(),
      })
      setDocs(prev => [{ id: ref.id, ...newDoc }, ...prev])
      setUrl('')
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="mc-page">
      <div className="mc-page__hd">
        <h1>Documents</h1>
      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">Process a Document</h2>
        <p className="mc-muted">Paste a URL to a PDF claim document. The AI will extract line items, materials, and a summary.</p>
        <form className="mc-form mc-form--row" onSubmit={handleProcess}>
          <input
            className="mc-input mc-input--grow"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/claim.pdf"
            type="url"
          />
          <button className="mc-btn mc-btn--primary" type="submit" disabled={processing}>
            {processing ? 'Processing…' : 'Process'}
          </button>
        </form>
        {error && <p className="mc-error">{error}</p>}
      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">All Documents</h2>
        {loading ? (
          <div className="mc-loading">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="mc-empty"><p>No documents processed yet.</p></div>
        ) : (
          <div className="mc-doc-list">
            {docs.map(d => (
              <div key={d.id} className="mc-doc-item">
                <div className="mc-doc-item__icon">📄</div>
                <div className="mc-doc-item__body">
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="mc-doc-item__name">
                    {d.name || d.fileUrl?.split('/').pop() || d.id}
                  </a>
                  {d.summary && <p className="mc-doc-item__summary">{d.summary}</p>}
                  {d.processedAt && (
                    <span className="mc-muted">{new Date(d.processedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

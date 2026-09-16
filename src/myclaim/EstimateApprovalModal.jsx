import { useState, useEffect, useRef } from 'react'
import SignaturePad from 'signature_pad'
import { generatePDF, fmtMoney } from './invoicePdf'
import './EstimateApprovalModal.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

export default function EstimateApprovalModal({ inv, viewToken, onClose, onApproved }) {
  const [signerName, setSignerName] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [done,       setDone]       = useState(null)
  const [sigEmpty,   setSigEmpty]   = useState(true)
  const canvasRef = useRef(null)
  const padRef    = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const pad = new SignaturePad(canvasRef.current, {
      penColor:        '#1e293b',
      backgroundColor: 'rgba(255,255,255,0)',
    })
    padRef.current = pad
    pad.addEventListener('endStroke', () => setSigEmpty(pad.isEmpty()))
    scalePad()

    function scalePad() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      canvas.width  = canvas.offsetWidth  * ratio
      canvas.height = canvas.offsetHeight * ratio
      canvas.getContext('2d').scale(ratio, ratio)
      pad.clear()
      setSigEmpty(true)
    }

    window.addEventListener('resize', scalePad)
    return () => { pad.off(); window.removeEventListener('resize', scalePad) }
  }, [])

  async function handleSubmit() {
    if (!signerName.trim())     { setError('Please enter your full name.'); return }
    if (padRef.current?.isEmpty()) { setError('Please provide your signature below.'); return }
    setLoading(true)
    setError('')
    try {
      let signerIp = ''
      try {
        const r = await fetch('https://api.ipify.org?format=json')
        signerIp = (await r.json()).ip || ''
      } catch {}

      const pdfDoc   = await generatePDF(inv, null)
      const pdfBase64 = pdfDoc.output('datauristring').split(',')[1]
      const signatureDataUrl = padRef.current.toDataURL('image/png')

      const r = await fetch(`${BACKEND}/signing/approve-estimate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewToken,
          pdfBase64,
          signatureDataUrl,
          signerName: signerName.trim(),
          signerIp,
          userAgent: navigator.userAgent.slice(0, 200),
        }),
      })
      const data = await r.json()
      if (!r.ok || data.error) {
        setError(data.error || 'Could not submit. Please try again.')
        return
      }
      setDone(data)
      onApproved?.(data.signedDocUrl)
    } catch (e) {
      console.error('approve-estimate:', e)
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="eam-overlay">
        <div className="eam-modal">
          <div className="eam-success">
            <div className="eam-success-icon">✅</div>
            <h3 className="eam-success-title">Estimate Approved!</h3>
            <p className="eam-success-body">
              Your signed copy has been saved to your project file.
              Download it using the button below.
            </p>
            <a
              href={done.signedDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="eam-btn eam-btn--primary"
            >
              ↓ Download Signed Estimate
            </a>
            <button className="eam-btn eam-btn--outline" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  const docLabel = inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'this estimate'

  return (
    <div className="eam-overlay" onClick={onClose}>
      <div className="eam-modal" onClick={e => e.stopPropagation()}>

        <div className="eam-header">
          <h3 className="eam-title">Sign &amp; Approve Estimate</h3>
          <p className="eam-subtitle">
            By signing below you approve estimate <strong>{docLabel}</strong> for{' '}
            <strong>{fmtMoney(inv.total)}</strong>. A signed PDF copy will be saved
            to your project file.
          </p>
        </div>

        <div className="eam-field">
          <label className="eam-label">Full Name <span className="eam-req">*</span></label>
          <input
            className="eam-input"
            placeholder="Type your full legal name"
            value={signerName}
            onChange={e => setSignerName(e.target.value)}
            disabled={loading}
            autoComplete="name"
          />
        </div>

        <div className="eam-field">
          <div className="eam-sig-header">
            <label className="eam-label">Signature <span className="eam-req">*</span></label>
            <button
              className="eam-clear-btn"
              type="button"
              onClick={() => { padRef.current?.clear(); setSigEmpty(true) }}
              disabled={sigEmpty}
            >
              Clear
            </button>
          </div>
          <div className="eam-sig-wrap">
            <canvas ref={canvasRef} className="eam-sig-canvas" />
            {sigEmpty && (
              <div className="eam-sig-hint">Draw your signature here</div>
            )}
          </div>
        </div>

        <p className="eam-legal">
          By clicking "Approve &amp; Sign" you agree that this electronic signature is
          legally binding. Your IP address, browser, and timestamp are recorded.
        </p>

        {error && <div className="eam-error">{error}</div>}

        <div className="eam-actions">
          <button className="eam-btn eam-btn--outline" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="eam-btn eam-btn--primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Processing…' : 'Approve & Sign'}
          </button>
        </div>
      </div>
    </div>
  )
}

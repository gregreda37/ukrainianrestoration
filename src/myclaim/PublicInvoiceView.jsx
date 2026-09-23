import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, increment } from 'firebase/firestore'
import { CONTRACT_CLAUSES } from './contractClauses'
import EstimateApprovalModal from './EstimateApprovalModal'
import './PublicInvoiceView.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function PublicInvoiceView() {
  const { token } = useParams()

  const [loading,         setLoading]         = useState(true)
  const [inv,             setInv]             = useState(null)
  const [attachedDocUrl,  setAttachedDocUrl]  = useState(null)
  const [err,             setErr]             = useState('')

  // Estimate-specific
  const [alreadyApproved, setAlreadyApproved] = useState(null)
  const [showApproval,    setShowApproval]    = useState(false)
  const [approvedDocUrl,  setApprovedDocUrl]  = useState(null)

  // Invoice signing state
  const [clientSigned,    setClientSigned]    = useState(false)
  const [clientSignedAt,  setClientSignedAt]  = useState('')
  const [clientSignerName, setClientSignerName] = useState('')

  // Signature pad
  const sigCanvasRef  = useRef(null)
  const drawingRef    = useRef(false)
  const lastPosRef    = useRef(null)
  const [sigEmpty,    setSigEmpty]    = useState(true)
  const [signerName,  setSignerName]  = useState('')
  const [agreed,      setAgreed]      = useState(false)
  const [signing,     setSigning]     = useState(false)
  const [signError,   setSignError]   = useState('')
  const [exporting,   setExporting]   = useState(false)

  useEffect(() => {
    if (!token) { setErr('Invalid link.'); setLoading(false); return }
    load()
  }, [token])

  // Set up signature canvas drawing once the section is visible
  useEffect(() => {
    const canvas = sigCanvasRef.current
    if (!canvas || clientSigned) return

    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth   = 2.2
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    function getPos(e) {
      const rect  = canvas.getBoundingClientRect()
      const scale = canvas.width / rect.width
      const src   = e.touches ? e.touches[0] : e
      return { x: (src.clientX - rect.left) * scale, y: (src.clientY - rect.top) * scale }
    }
    function onDown(e) {
      e.preventDefault()
      drawingRef.current = true
      const p = getPos(e)
      lastPosRef.current = p
      ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2); ctx.fill()
      setSigEmpty(false)
    }
    function onMove(e) {
      e.preventDefault()
      if (!drawingRef.current) return
      const p = getPos(e)
      ctx.beginPath()
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      lastPosRef.current = p
    }
    function onUp() { drawingRef.current = false }

    canvas.addEventListener('mousedown',  onDown)
    canvas.addEventListener('mousemove',  onMove)
    canvas.addEventListener('mouseup',    onUp)
    canvas.addEventListener('mouseleave', onUp)
    canvas.addEventListener('touchstart', onDown, { passive: false })
    canvas.addEventListener('touchmove',  onMove, { passive: false })
    canvas.addEventListener('touchend',   onUp)

    return () => {
      canvas.removeEventListener('mousedown',  onDown)
      canvas.removeEventListener('mousemove',  onMove)
      canvas.removeEventListener('mouseup',    onUp)
      canvas.removeEventListener('mouseleave', onUp)
      canvas.removeEventListener('touchstart', onDown)
      canvas.removeEventListener('touchmove',  onMove)
      canvas.removeEventListener('touchend',   onUp)
    }
  }, [inv, clientSigned])

  async function load() {
    try {
      const snap = await getDoc(doc(db, 'view_links', token))
      if (!snap.exists()) { setErr('This link is invalid or has expired.'); setLoading(false); return }
      const data = snap.data()
      const expiresRaw  = data.expiresAt
      const expiresDate = expiresRaw?.toDate ? expiresRaw.toDate() : new Date(expiresRaw)
      if (expiresDate < new Date()) { setErr('This link has expired.'); setLoading(false); return }

      const invoice = data.invoice
      setInv(invoice)
      if (data.attachedDocUrl) setAttachedDocUrl(data.attachedDocUrl)

      // Estimate approval state
      if (data.approvedAt && data.signedDocUrl) setAlreadyApproved({ signedDocUrl: data.signedDocUrl })

      // Invoice signing state
      if (data.clientSignedAt) {
        setClientSigned(true)
        setClientSignedAt(data.clientSignedAt)
        setClientSignerName(data.clientSignerName || '')
      }

      // Track open
      updateDoc(doc(db, 'view_links', token), {
        openCount: increment(1), lastOpenedAt: serverTimestamp(),
      }).catch(() => {})

      const { clientUid } = data
      if (clientUid) {
        const typeLabel = invoice?.type === 'estimate' ? 'Estimate' : invoice?.type === 'receipt' ? 'Receipt' : 'Invoice'
        addDoc(collection(db, 'users', clientUid, 'activity'), {
          type: 'invoice_link_opened',
          details: `${typeLabel}${invoice?.invoiceNumber ? ` #${invoice.invoiceNumber}` : ''} view link opened`,
          timestamp: serverTimestamp(), actor: 'client',
        }).catch(() => {})
      }
    } catch {
      setErr('Could not load the document. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function downloadPDF() {
    if (exporting) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      const pdf    = new jsPDF({ unit: 'pt', format: 'letter' })
      const pageW  = pdf.internal.pageSize.getWidth()   // 612
      const pageH  = pdf.internal.pageSize.getHeight()  // 792
      const margin = 28
      const imgW   = pageW - margin * 2

      // Captures one element and appends it to the PDF, paginating if it's taller than one page.
      async function appendSection(el, isFirstSection) {
        const canvas   = await html2canvas(el, {
          scale:           2,
          useCORS:         true,
          allowTaint:      false,
          backgroundColor: '#ffffff',
          logging:         false,
          windowWidth:     840,
        })
        const scale   = imgW / canvas.width          // pt per canvas-pixel
        const slicePx = (pageH - margin * 2) / scale // canvas pixels that fit one page
        let srcY = 0
        let chunksAdded = 0

        while (srcY < canvas.height) {
          const needsNewPage = !isFirstSection || chunksAdded > 0
          if (needsNewPage) pdf.addPage()

          const chunkPx = Math.min(slicePx, canvas.height - srcY)
          const tmp     = document.createElement('canvas')
          tmp.width     = canvas.width
          tmp.height    = chunkPx
          tmp.getContext('2d').drawImage(
            canvas, 0, srcY, canvas.width, chunkPx,
            0,      0, canvas.width, chunkPx,
          )
          pdf.addImage(tmp.toDataURL('image/jpeg', 0.93), 'JPEG', margin, margin, imgW, chunkPx * scale)
          srcY += slicePx
          chunksAdded++
        }
      }

      const invoiceEl = document.querySelector('.piv-doc')
      if (invoiceEl) await appendSection(invoiceEl, true)

      const termsEl = document.querySelector('.piv-terms-card')
      if (termsEl) await appendSection(termsEl, false)

      if (clientSigned) {
        const signEl = document.querySelector('.piv-sign-card')
        if (signEl) await appendSection(signEl, false)
      }

      const docType  = inv.type === 'estimate' ? 'Estimate' : inv.type === 'receipt' ? 'Receipt' : 'Invoice'
      const filename = `${docType}${inv.invoiceNumber ? `_${inv.invoiceNumber}` : ''}.pdf`
      pdf.save(filename)
    } catch (e) {
      console.error('downloadPDF:', e)
    } finally {
      setExporting(false)
    }
  }

  function clearSignature() {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setSigEmpty(true)
  }

  async function submitSignature() {
    if (!signerName.trim() || sigEmpty || !agreed) return
    setSigning(true)
    setSignError('')
    try {
      let signerIp = ''
      try {
        const r = await fetch('https://api.ipify.org?format=json')
        signerIp = (await r.json()).ip
      } catch {}

      const signatureDataUrl = sigCanvasRef.current.toDataURL('image/png')

      const resp = await fetch(`${BACKEND}/signing/sign-invoice-view`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewToken: token,
          signerName: signerName.trim(),
          signerIp,
          userAgent: navigator.userAgent,
          signatureDataUrl,
        }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) { setSignError(data.error || 'Could not save signature.'); return }
      setClientSigned(true)
      setClientSignedAt(data.signedAt || '')
      setClientSignerName(signerName.trim())
    } catch {
      setSignError('Network error. Please try again.')
    } finally {
      setSigning(false)
    }
  }

  // ── Loading / error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="piv-loading">
      <div className="piv-loading-spinner" />
      <span>Loading document…</span>
    </div>
  )
  if (err) return (
    <div className="piv-error-wrap">
      <div className="piv-error-card">
        <div className="piv-error-icon">⚠️</div>
        <h2>Link Unavailable</h2>
        <p>{err}</p>
      </div>
    </div>
  )
  if (!inv) return (
    <div className="piv-error-wrap">
      <div className="piv-error-card">
        <div className="piv-error-icon">⚠️</div>
        <h2>Link Unavailable</h2>
        <p>This document could not be loaded.</p>
      </div>
    </div>
  )

  const t          = inv
  const docType    = t.type || (t.validUntil ? 'estimate' : 'invoice')
  const isReceipt  = docType === 'receipt' || t.status === 'paid'
  const isEstimate = docType === 'estimate'
  const isInvoice  = !isEstimate && !isReceipt
  const typeLabel  = isEstimate ? 'ESTIMATE' : isReceipt ? 'RECEIPT' : 'INVOICE'
  const approvedUrl = approvedDocUrl || alreadyApproved?.signedDocUrl
  const companyName = t.companyName || 'the contractor'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="piv-root">

      {/* ── Sticky nav + action bar ── */}
      <nav className="piv-progress no-print">
        <div className="piv-prog-steps">
          <a className="piv-prog-step" href="#piv-invoice">Invoice</a>
          {isInvoice && <><span className="piv-prog-sep">›</span><a className="piv-prog-step" href="#piv-terms">Agreement</a></>}
          {attachedDocUrl && <><span className="piv-prog-sep">›</span><a className="piv-prog-step" href="#piv-attachment">Reference Doc</a></>}
          {isInvoice && <><span className="piv-prog-sep">›</span><a className="piv-prog-step" href="#piv-sign">{clientSigned ? '✅ Signed' : 'Sign'}</a></>}
        </div>
        <div className="piv-prog-actions">
          <button className="piv-download-btn" onClick={downloadPDF} disabled={exporting}>
            {exporting ? 'Generating…' : '↓ Download PDF'}
          </button>
          {isInvoice && !clientSigned && (
            <a className="piv-sign-nav-btn" href="#piv-sign">✍️ Sign</a>
          )}
          {isEstimate && !approvedUrl && (
            <button className="piv-approve-btn" onClick={() => setShowApproval(true)}>
              ✍️ Approve
            </button>
          )}
          {isEstimate && approvedUrl && (
            <a href={approvedUrl} target="_blank" rel="noopener noreferrer" className="piv-approved-btn">
              ✅ Signed
            </a>
          )}
        </div>
      </nav>

      {isEstimate && approvedUrl && (
        <div className="piv-approved-banner no-print">
          <span>✅ This estimate has been signed and approved.</span>
          <a href={approvedUrl} target="_blank" rel="noopener noreferrer">Download signed copy ↓</a>
        </div>
      )}

      {/* ══════════════════ SECTION 1: INVOICE ══════════════════ */}
      <section id="piv-invoice" className="piv-doc-section">
        <div className="piv-doc">

          {/* Header */}
          <div className="piv-header">
            <div className="piv-company">
              {t.companyLogoUrl
                ? <img src={t.companyLogoUrl} alt="" className="piv-logo" />
                : <div className="piv-logo-placeholder">{(t.companyName || 'U')[0]}</div>
              }
              <div className="piv-company-info">
                <div className="piv-company-name">{t.companyName}</div>
                {t.companyAddress && <div className="piv-company-line">{t.companyAddress}</div>}
                {t.companyPhone   && <div className="piv-company-line">{t.companyPhone}</div>}
                {t.companyLicense && <div className="piv-company-line">Lic: {t.companyLicense}</div>}
              </div>
            </div>
            <div className="piv-doc-meta">
              <div className="piv-doc-type">{typeLabel}</div>
              {t.invoiceNumber && <div className="piv-doc-number">#{t.invoiceNumber}</div>}
              <div className="piv-meta-row"><span>Date:</span><span>{fmtDate(t.issueDate)}</span></div>
              {t.dueDate && !isEstimate && <div className="piv-meta-row"><span>Due:</span><span>{fmtDate(t.dueDate)}</span></div>}
              {(t.validUntil || (isEstimate && t.dueDate)) && (
                <div className="piv-meta-row"><span>Valid Until:</span><span>{fmtDate(t.validUntil || t.dueDate)}</span></div>
              )}
              {t.claimNumbers?.length > 0 && (
                <div className="piv-meta-row"><span>Claim #:</span><span>{t.claimNumbers.join(', ')}</span></div>
              )}
            </div>
          </div>

          {/* Billing */}
          <div className="piv-bill-row">
            <div className="piv-bill-block">
              <div className="piv-bill-label">Bill To</div>
              {t.clientName    && <div className="piv-bill-name">{t.clientName}</div>}
              {t.clientAddress && <div className="piv-bill-line">{t.clientAddress}</div>}
              {t.clientPhone   && <div className="piv-bill-line">{t.clientPhone}</div>}
              {t.clientEmail   && <div className="piv-bill-line">{t.clientEmail}</div>}
            </div>
          </div>

          {/* Line items */}
          <table className="piv-table">
            <thead>
              <tr>
                <th className="piv-th piv-th--item">Item</th>
                <th className="piv-th piv-th--desc">Description</th>
                <th className="piv-th piv-th--num">Qty</th>
                <th className="piv-th piv-th--num">Unit Price</th>
                <th className="piv-th piv-th--num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(t.lineItems || []).map((item, i) => (
                <tr key={item.id || i} className="piv-tr">
                  <td className="piv-td piv-td--item">
                    <div className="piv-item-label">{item.label}</div>
                    {item.taxExempt && <span className="piv-tax-exempt-badge">Tax Exempt</span>}
                  </td>
                  <td className="piv-td piv-td--desc-body">{item.description || ''}</td>
                  <td className="piv-td piv-td--num">{item.qty}</td>
                  <td className="piv-td piv-td--num">{fmtMoney(item.price)}</td>
                  <td className="piv-td piv-td--num">{fmtMoney(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="piv-totals">
            <div className="piv-total-row"><span>Subtotal</span><span>{fmtMoney(t.subtotal)}</span></div>
            {t.discount > 0 && (
              <div className="piv-total-row piv-total-row--discount"><span>Discount</span><span>−{fmtMoney(t.discount)}</span></div>
            )}
            {t.taxAmount > 0 && (
              <div className="piv-total-row">
                <span>Tax ({t.taxRate}%{t.taxState ? ` — ${t.taxState}` : ''})</span>
                <span>{fmtMoney(t.taxAmount)}</span>
              </div>
            )}
            <div className="piv-total-row piv-total-row--grand"><span>Total</span><span>{fmtMoney(t.total)}</span></div>
            {(t.claimCoveredAmount || 0) > 0 && (
              <>
                <div className="piv-total-row piv-total-row--claim">
                  <span>Insurance covered</span><span>{fmtMoney(t.claimCoveredAmount)}</span>
                </div>
                {Math.max(0, t.total - t.claimCoveredAmount) > 0 && (
                  <div className="piv-total-row piv-total-row--above">
                    <span>Amount above claim</span><span>{fmtMoney(Math.max(0, t.total - t.claimCoveredAmount))}</span>
                  </div>
                )}
              </>
            )}
            {isReceipt && <div className="piv-paid-badge">✓ PAID</div>}
          </div>

          {/* Notes */}
          {t.notes && (
            <div className="piv-section">
              <div className="piv-section-label">Notes</div>
              <div className="piv-section-body">{t.notes}</div>
            </div>
          )}
          {t.terms && (
            <div className="piv-section">
              <div className="piv-section-label">Terms &amp; Conditions</div>
              <div className="piv-section-body">{t.terms}</div>
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════ SECTION 2: AGREEMENT & TERMS (invoices only) ══════════════════ */}
      {isInvoice && (
        <section id="piv-terms" className="piv-terms-section">
          <div className="piv-terms-card">
            <div className="piv-terms-header">
              <div className="piv-terms-header-inner">
                <h2 className="piv-terms-title">Invoice Agreement &amp; Terms</h2>
                <p className="piv-terms-subtitle">
                  {t.invoiceNumber ? `Invoice #${t.invoiceNumber}` : 'Invoice'} · {t.clientName} · {fmtDate(t.issueDate)}
                </p>
              </div>
            </div>

            {/* Insurance scope notice */}
            {t.disclaimer && (
              <div className="piv-clause piv-clause--insurance">
                <div className="piv-clause-title">Insurance Scope Notice</div>
                <div className="piv-clause-body">{t.disclaimer}</div>
              </div>
            )}

            <div className="piv-clauses-heading">Standard Contract Terms &amp; Conditions</div>

            {CONTRACT_CLAUSES.map((clause, i) => (
              <div key={i} className="piv-clause">
                <div className="piv-clause-title">{clause.title}</div>
                <div className="piv-clause-body">
                  {clause.body.replace(/\[Company Name\]/g, companyName)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════ SECTION 3: ATTACHED REFERENCE DOCUMENT ══════════════════ */}
      {attachedDocUrl && (
        <section id="piv-attachment" className="piv-attachment-section">
          <div className="piv-attachment-card">
            <div className="piv-attachment-header">
              <h2 className="piv-attachment-title">Reference Document</h2>
              <p className="piv-attachment-subtitle">Insurance scope / estimate attached for reference</p>
            </div>
            <div className="piv-attachment-embed-wrap">
              {/* <object> loads cross-origin PDFs natively — no CORS restriction for browser resource loads */}
              <object
                data={attachedDocUrl}
                type="application/pdf"
                className="piv-attachment-embed"
                aria-label="Reference document"
              >
                {/* Fallback for browsers/devices that can't render PDFs inline (e.g. iOS Safari) */}
                <div className="piv-attachment-fallback">
                  <p>Your browser cannot display the PDF inline.</p>
                  <a href={attachedDocUrl} target="_blank" rel="noopener noreferrer" className="piv-attachment-open-btn">
                    Open PDF ↗
                  </a>
                </div>
              </object>
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════ SECTION 4: SIGN ══════════════════ */}
      {isInvoice && (
        <section id="piv-sign" className="piv-sign-section">
          <div className="piv-sign-card">
            {clientSigned ? (
              <div className="piv-signed-confirm">
                <div className="piv-signed-icon">✅</div>
                <h2 className="piv-signed-title">Agreement Signed</h2>
                <p className="piv-signed-body">
                  Signed by <strong>{clientSignerName}</strong>
                  {clientSignedAt ? ` on ${clientSignedAt}` : ''}.
                </p>
                <p className="piv-signed-note">
                  The contractor will review and countersign. A fully executed copy will be saved to your file.
                </p>
              </div>
            ) : (
              <>
                <div className="piv-sign-header">
                  <h2 className="piv-sign-title">Sign &amp; Agree</h2>
                  <p className="piv-sign-subtitle">
                    Please scroll through and review all sections above, then sign below to acknowledge and agree to the invoice and all terms.
                  </p>
                </div>

                <div className="piv-sign-name-row">
                  <label className="piv-sign-label" htmlFor="piv-signer-name">Full Name</label>
                  <input
                    id="piv-signer-name"
                    className="piv-sign-input"
                    type="text"
                    placeholder="Your full legal name"
                    value={signerName}
                    onChange={e => setSignerName(e.target.value)}
                  />
                </div>

                <div className="piv-sig-area">
                  <div className="piv-sig-label-row">
                    <span className="piv-sign-label">Signature</span>
                    {!sigEmpty && (
                      <button type="button" className="piv-sig-clear" onClick={clearSignature}>
                        Clear
                      </button>
                    )}
                  </div>
                  <canvas
                    ref={sigCanvasRef}
                    className="piv-sig-canvas"
                    width={600}
                    height={160}
                  />
                  {sigEmpty && <div className="piv-sig-hint">Draw your signature above</div>}
                </div>

                <label className="piv-agree-row">
                  <input
                    type="checkbox"
                    className="piv-agree-check"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                  />
                  <span>
                    I have read and agree to all terms and conditions in this invoice agreement,
                    including the payment terms, insurance cooperation requirements, and all
                    standard contract clauses above. I understand this constitutes a legally
                    binding electronic signature.
                  </span>
                </label>

                {signError && <div className="piv-sign-error">{signError}</div>}

                <button
                  className="piv-sign-submit"
                  onClick={submitSignature}
                  disabled={signing || !signerName.trim() || sigEmpty || !agreed}
                >
                  {signing ? 'Saving signature…' : '✍️ Sign & Submit'}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* Estimate approval modal */}
      {showApproval && (
        <EstimateApprovalModal
          inv={inv}
          viewToken={token}
          onClose={() => setShowApproval(false)}
          onApproved={url => { setApprovedDocUrl(url); setShowApproval(false) }}
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, increment } from 'firebase/firestore'
import EstimateApprovalModal from './EstimateApprovalModal'
import './PublicInvoiceView.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function PublicInvoiceView() {
  const { token } = useParams()
  const [loading,     setLoading]     = useState(true)
  const [inv,         setInv]         = useState(null)
  const [err,         setErr]         = useState('')
  const [alreadyApproved, setAlreadyApproved] = useState(null) // { signedDocUrl } if pre-approved
  const [showApproval,    setShowApproval]    = useState(false)
  const [approvedDocUrl,  setApprovedDocUrl]  = useState(null)

  useEffect(() => {
    if (!token) { setErr('Invalid link.'); setLoading(false); return }
    load()
  }, [token])

  async function load() {
    try {
      const snap = await getDoc(doc(db, 'view_links', token))
      if (!snap.exists()) { setErr('This link is invalid or has expired.'); setLoading(false); return }
      const data = snap.data()
      const expiresRaw = data.expiresAt
      const expiresDate = expiresRaw?.toDate ? expiresRaw.toDate() : new Date(expiresRaw)
      if (expiresDate < new Date()) { setErr('This link has expired.'); setLoading(false); return }
      setInv(data.invoice)

      if (data.approvedAt && data.signedDocUrl) {
        setAlreadyApproved({ signedDocUrl: data.signedDocUrl })
      }

      // Track open — fire-and-forget, never block rendering
      const { clientUid, invoice: inv } = data
      updateDoc(doc(db, 'view_links', token), {
        openCount: increment(1),
        lastOpenedAt: serverTimestamp(),
      }).catch(() => {})

      if (clientUid) {
        const typeLabel = inv?.type === 'estimate' ? 'Estimate' : inv?.type === 'receipt' ? 'Receipt' : 'Invoice'
        addDoc(collection(db, 'users', clientUid, 'activity'), {
          type: 'invoice_link_opened',
          details: `${typeLabel}${inv?.invoiceNumber ? ` #${inv.invoiceNumber}` : ''} view link opened`,
          timestamp: serverTimestamp(),
          actor: 'client',
        }).catch(() => {})
      }
    } catch {
      setErr('Could not load the document. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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
        <p>This document could not be loaded. The link may be invalid.</p>
      </div>
    </div>
  )

  const t = inv
  // Infer type from validUntil for older documents that may lack an explicit type field
  const docType    = t.type || (t.validUntil ? 'estimate' : 'invoice')
  const isReceipt  = docType === 'receipt' || t.status === 'paid'
  const isEstimate = docType === 'estimate'
  const typeLabel  = isEstimate ? 'ESTIMATE' : isReceipt ? 'RECEIPT' : 'INVOICE'

  const approvedUrl = approvedDocUrl || alreadyApproved?.signedDocUrl

  return (
    <div className="piv-root">
      <div className="piv-actions no-print">
        <button className="piv-print-btn" onClick={() => window.print()}>
          🖨 Print / Save as PDF
        </button>
        {isEstimate && !approvedUrl && (
          <button className="piv-approve-btn" onClick={() => setShowApproval(true)}>
            ✍️ Sign &amp; Approve Estimate
          </button>
        )}
        {isEstimate && approvedUrl && (
          <a
            href={approvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="piv-approved-btn"
          >
            ✅ Download Signed Estimate
          </a>
        )}
      </div>

      {isEstimate && approvedUrl && (
        <div className="piv-approved-banner no-print">
          <span>✅ This estimate has been signed and approved.</span>
          <a href={approvedUrl} target="_blank" rel="noopener noreferrer">
            Download signed copy ↓
          </a>
        </div>
      )}

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
            {t.dueDate && !isEstimate && (
              <div className="piv-meta-row"><span>Due:</span><span>{fmtDate(t.dueDate)}</span></div>
            )}
            {t.validUntil && (
              <div className="piv-meta-row"><span>Valid Until:</span><span>{fmtDate(t.validUntil)}</span></div>
            )}
            {isEstimate && t.dueDate && !t.validUntil && (
              <div className="piv-meta-row"><span>Valid Until:</span><span>{fmtDate(t.dueDate)}</span></div>
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
              <th className="piv-th piv-th--desc">Description</th>
              <th className="piv-th piv-th--num">Qty</th>
              <th className="piv-th piv-th--unit">Unit</th>
              <th className="piv-th piv-th--num">Unit Price</th>
              <th className="piv-th piv-th--num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(t.lineItems || []).map((item, i) => (
              <tr key={item.id || i} className="piv-tr">
                <td className="piv-td">
                  <div className="piv-item-label">{item.label}</div>
                  {item.description && <div className="piv-item-desc">{item.description}</div>}
                </td>
                <td className="piv-td piv-td--num">{item.qty}</td>
                <td className="piv-td piv-td--num">{item.unit}</td>
                <td className="piv-td piv-td--num">{fmtMoney(item.price)}</td>
                <td className="piv-td piv-td--num">{fmtMoney(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="piv-totals">
          <div className="piv-total-row">
            <span>Subtotal</span><span>{fmtMoney(t.subtotal)}</span>
          </div>
          {t.discount > 0 && (
            <div className="piv-total-row piv-total-row--discount">
              <span>Discount</span><span>−{fmtMoney(t.discount)}</span>
            </div>
          )}
          {t.taxAmount > 0 && (
            <div className="piv-total-row">
              <span>Tax ({t.taxRate}%{t.taxState ? ` — ${t.taxState}` : ''})</span>
              <span>{fmtMoney(t.taxAmount)}</span>
            </div>
          )}
          <div className="piv-total-row piv-total-row--grand">
            <span>Total</span><span>{fmtMoney(t.total)}</span>
          </div>
          {isReceipt && <div className="piv-paid-badge">✓ PAID</div>}
        </div>

        {/* Notes / Terms */}
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

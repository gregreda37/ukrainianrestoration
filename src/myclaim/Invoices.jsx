import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import {
  collection, getDocs, doc, getDoc, deleteDoc, orderBy, query
} from 'firebase/firestore'
import { useAuth } from './useAuth'
import './Invoices.css'

const STATUS_META = {
  draft:     { label: 'Draft',     color: '#64748b', bg: '#f1f5f9' },
  sent:      { label: 'Sent',      color: '#2563eb', bg: '#eff6ff' },
  viewed:    { label: 'Viewed',    color: '#7c3aed', bg: '#f5f3ff' },
  approved:  { label: 'Approved',  color: '#16a34a', bg: '#f0fdf4' },
  paid:      { label: 'Paid',      color: '#15803d', bg: '#dcfce7' },
  overdue:   { label: 'Overdue',   color: '#dc2626', bg: '#fef2f2' },
  converted: { label: 'Converted', color: '#d97706', bg: '#fffbeb' },
  cancelled: { label: 'Cancelled', color: '#94a3b8', bg: '#f8fafc' },
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function Invoices() {
  const { id: phone } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [invoices, setInvoices]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [clientUid, setClientUid]     = useState(null)
  const [clientDocId, setClientDocId] = useState('')
  const [clientName, setClientName]   = useState('')
  const [orgId, setOrgId]             = useState('')
  const [deleting, setDeleting]       = useState(null)
  const [confirmDel, setConfirmDel]   = useState(null)

  useEffect(() => {
    if (!user) return
    load()
  }, [user, phone])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const clientsSnap = await getDocs(collection(db, 'organization_data', oid, 'clients'))
      const clientDoc = clientsSnap.docs.find(d => {
        const p = d.data().phone || ''
        return p === phone || p.replace(/\D/g,'') === phone.replace(/\D/g,'')
      })
      if (!clientDoc) return

      const cdata = clientDoc.data()
      const docId = clientDoc.id
      const uid   = cdata.uid
      setClientUid(uid)
      setClientDocId(docId)
      setClientName(cdata.name || '')

      const orgInvQuery = query(
        collection(db, 'organization_data', oid, 'clients', docId, 'invoices'),
        orderBy('createdAt', 'desc')
      )

      if (!uid) {
        const snap = await getDocs(orgInvQuery).catch(() => null)
        setInvoices(snap?.docs.map(d => ({ id: d.id, _isOrgInvoice: true, ...d.data() })) || [])
        return
      }

      const [userInvSnap, orgInvSnap] = await Promise.all([
        getDocs(query(collection(db, 'users', uid, 'invoices'), orderBy('createdAt', 'desc'))),
        getDocs(orgInvQuery).catch(() => null),
      ])
      const userInvs = userInvSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const orgInvs  = orgInvSnap?.docs.map(d => ({ id: d.id, _isOrgInvoice: true, ...d.data() })) || []
      const seenIds  = new Set(userInvs.map(i => i.id))
      setInvoices([...userInvs, ...orgInvs.filter(i => !seenIds.has(i.id))])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function doDelete(inv) {
    if (!clientUid && !clientDocId) return
    setDeleting(inv.id)
    try {
      const invDocRef = (inv._isOrgInvoice || !clientUid)
        ? doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', inv.id)
        : doc(db, 'users', clientUid, 'invoices', inv.id)
      await deleteDoc(invDocRef)
      if (orgId) {
        await deleteDoc(doc(db, 'organization_data', orgId, 'invoice_summary', inv.id)).catch(() => {})
      }
      setInvoices(prev => prev.filter(i => i.id !== inv.id))
    } finally {
      setDeleting(null)
      setConfirmDel(null)
    }
  }

  const estimates = invoices.filter(i => i.type === 'estimate')
  const invList   = invoices.filter(i => i.type === 'invoice' && i.status !== 'paid')
  const receipts  = invoices.filter(i => i.type === 'receipt' || (i.type === 'invoice' && i.status === 'paid'))

  const basePath = `/myclaim/clients/${encodeURIComponent(phone)}/invoices`

  return (
    <div className="inv-root">
      <button className="inv-back" onClick={() => navigate(-1)}>← Back</button>
      <div className="inv-header">
        <div>
          <h2 className="inv-title">Invoices &amp; Estimates</h2>
          {clientName && <p className="inv-sub">{clientName}</p>}
        </div>
        <div className="inv-header-actions">
          <button className="inv-btn inv-btn--outline" onClick={() => navigate(`${basePath}/new?type=estimate`)}>
            + New Estimate
          </button>
          <button className="inv-btn inv-btn--primary" onClick={() => navigate(`${basePath}/new?type=invoice`)}>
            + New Invoice
          </button>
          <button className="inv-btn inv-btn--receipt" onClick={() => navigate(`${basePath}/new?type=receipt`)}>
            + Receipt
          </button>
        </div>
      </div>

      {loading ? (
        <div className="inv-empty">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="inv-empty-state">
          <div className="inv-empty-icon">🧾</div>
          <p className="inv-empty-title">No invoices yet</p>
          <p className="inv-empty-sub">Create an estimate to get started.</p>
          <button className="inv-btn inv-btn--primary" onClick={() => navigate(`${basePath}/new?type=estimate`)}>
            + New Estimate
          </button>
        </div>
      ) : (
        <>
          {estimates.length > 0 && (
            <Section title="Estimates" items={estimates} basePath={basePath}
              onDelete={setConfirmDel} />
          )}
          {invList.length > 0 && (
            <Section title="Invoices" items={invList} basePath={basePath}
              onDelete={setConfirmDel} />
          )}
          {receipts.length > 0 && (
            <Section title="Receipts" items={receipts} basePath={basePath}
              onDelete={setConfirmDel} isReceipts />
          )}
        </>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="inv-overlay" onClick={() => setConfirmDel(null)}>
          <div className="inv-modal" onClick={e => e.stopPropagation()}>
            <p className="inv-modal-title">Delete {confirmDel.type === 'estimate' ? 'Estimate' : 'Invoice'}?</p>
            <p className="inv-modal-body">{confirmDel.invoiceNumber} — {fmtMoney(confirmDel.total)} will be permanently removed.</p>
            <div className="inv-modal-actions">
              <button className="inv-btn inv-btn--outline" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="inv-btn inv-btn--danger" disabled={!!deleting}
                onClick={() => doDelete(confirmDel)}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, items, basePath, onDelete, isReceipts }) {
  return (
    <div className="inv-section">
      <h3 className="inv-section-title">
        {title}
        {isReceipts && <span className="inv-section-paid-badge">✓ PAID</span>}
      </h3>
      <div className="inv-list">
        {items.map(inv => {
          const meta = STATUS_META[inv.status] || STATUS_META.draft
          const dateLabel = inv.type === 'receipt' ? 'Payment date' : inv.type === 'invoice' ? 'Due' : 'Valid until'
          return (
            <div key={inv.id} className={`inv-card${isReceipts ? ' inv-card--receipt' : ''}`}>
              <div className="inv-card-left">
                <div className="inv-card-num">{inv.invoiceNumber || '—'}</div>
                <div className="inv-card-client">{inv.clientName}</div>
                <div className="inv-card-date">
                  {dateLabel}: {fmtDate(inv.dueDate || inv.validUntil)}
                </div>
                {inv.status === 'converted' && inv.convertedInvoiceId && (
                  <div className="inv-card-converted">→ Invoice created</div>
                )}
              </div>
              <div className="inv-card-right">
                <div className="inv-card-amount">{fmtMoney(inv.total)}</div>
                {isReceipts ? (
                  <span className="inv-badge inv-badge--paid-large">✓ PAID</span>
                ) : (
                  <span className="inv-badge" style={{ color: meta.color, background: meta.bg }}>
                    {meta.label}
                  </span>
                )}
                <div className="inv-card-actions">
                  <button className="inv-action-btn" onClick={() => window.location.href = `${basePath}/${inv.id}`}>
                    View
                  </button>
                  <button className="inv-action-btn inv-action-btn--delete" onClick={() => onDelete(inv)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

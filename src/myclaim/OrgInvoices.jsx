import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { useAuth } from './useAuth'
import InvoiceReport from './InvoiceReport'
import './OrgInvoices.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const STATUS_META = {
  draft:     { label: 'Draft',     color: '#64748b', bg: '#f1f5f9' },
  sent:      { label: 'Sent',      color: '#2563eb', bg: '#eff6ff' },
  viewed:    { label: 'Viewed',    color: '#7c3aed', bg: '#f5f3ff' },
  approved:  { label: 'Approved',  color: '#16a34a', bg: '#f0fdf4' },
  overdue:   { label: 'Overdue',   color: '#dc2626', bg: '#fef2f2' },
}

// ── OrgInvoiceList ────────────────────────────────────────────────────────────

function OrgInvoiceList() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rows, setRows]       = useState([])

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      const snap = await getDocs(collection(db, 'organization_data', oid, 'invoice_summary'))
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

  const today = todayStr()

  const { overdue, openInvoices, estimates } = useMemo(() => {
    const overdue      = []
    const openInvoices = []
    const estimates    = []

    for (const r of rows) {
      if (r.type === 'receipt') continue
      if (['paid', 'cancelled', 'converted'].includes(r.status)) continue

      if (r.type === 'invoice') {
        const pastDue = r.dueDate && r.dueDate < today
        if (pastDue) overdue.push({ ...r, _overdue: true })
        else openInvoices.push(r)
      } else if (r.type === 'estimate') {
        estimates.push(r)
      }
    }

    overdue.sort((a, b) => (a.dueDate || '') < (b.dueDate || '') ? -1 : 1)
    openInvoices.sort((a, b) => (a.dueDate || '') < (b.dueDate || '') ? -1 : 1)
    estimates.sort((a, b) => (a.issueDate || '') > (b.issueDate || '') ? -1 : 1)

    return { overdue, openInvoices, estimates }
  }, [rows, today])

  const totalReceivable = [...overdue, ...openInvoices].reduce((s, r) => s + (r.total || 0), 0)
  const totalOverdue    = overdue.reduce((s, r) => s + (r.total || 0), 0)
  const totalEstimates  = estimates.reduce((s, r) => s + (r.total || 0), 0)

  function goTo(r) {
    const phone = r.clientPhone
    const invId = r.invoiceId || r.id
    if (!phone || !invId) return
    navigate(`/myclaim/clients/${encodeURIComponent(phone)}/invoices/${invId}`)
  }

  if (loading) return <div className="oil-loading">Loading…</div>

  const isEmpty = overdue.length + openInvoices.length + estimates.length === 0

  return (
    <div className="oil-root">
      <div className="oil-page-header">
        <div>
          <h2 className="oil-title">Open Work</h2>
          <p className="oil-sub">All outstanding invoices &amp; estimates across every client</p>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="oil-kpi-row">
        <div className="oil-kpi">
          <div className="oil-kpi-label">Total Receivable</div>
          <div className="oil-kpi-val">{fmtMoney(totalReceivable)}</div>
          <div className="oil-kpi-sub">{overdue.length + openInvoices.length} open invoice{overdue.length + openInvoices.length !== 1 ? 's' : ''}</div>
        </div>
        <div className={`oil-kpi${totalOverdue > 0 ? ' oil-kpi--danger' : ''}`}>
          <div className="oil-kpi-label">Overdue</div>
          <div className="oil-kpi-val">{fmtMoney(totalOverdue)}</div>
          <div className="oil-kpi-sub">{overdue.length} invoice{overdue.length !== 1 ? 's' : ''} past due</div>
        </div>
        <div className="oil-kpi oil-kpi--amber">
          <div className="oil-kpi-label">Pending Estimates</div>
          <div className="oil-kpi-val">{fmtMoney(totalEstimates)}</div>
          <div className="oil-kpi-sub">{estimates.length} estimate{estimates.length !== 1 ? 's' : ''} open</div>
        </div>
      </div>

      {isEmpty ? (
        <div className="oil-empty">
          <div className="oil-empty-icon">✓</div>
          <p className="oil-empty-title">All caught up</p>
          <p className="oil-empty-sub">No open invoices or estimates right now.</p>
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <Section
              title="Overdue"
              accent="#dc2626"
              accentBg="#fef2f2"
              items={overdue}
              onRowClick={goTo}
              dateLabel="Was due"
              dateKey="dueDate"
            />
          )}
          {openInvoices.length > 0 && (
            <Section
              title="Open Invoices"
              accent="#2563eb"
              accentBg="#eff6ff"
              items={openInvoices}
              onRowClick={goTo}
              dateLabel="Due"
              dateKey="dueDate"
            />
          )}
          {estimates.length > 0 && (
            <Section
              title="Estimates"
              accent="#d97706"
              accentBg="#fffbeb"
              items={estimates}
              onRowClick={goTo}
              dateLabel="Issued"
              dateKey="issueDate"
            />
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, accent, accentBg, items, onRowClick, dateLabel, dateKey }) {
  const total = items.reduce((s, r) => s + (r.total || 0), 0)
  return (
    <div className="oil-section">
      <div className="oil-section-header" style={{ borderLeftColor: accent }}>
        <div className="oil-section-left">
          <span className="oil-section-title" style={{ color: accent }}>{title}</span>
          <span className="oil-section-count" style={{ background: accentBg, color: accent }}>
            {items.length}
          </span>
        </div>
        <span className="oil-section-total">{fmtMoney(total)}</span>
      </div>

      <div className="oil-table-wrap">
        <table className="oil-table">
          <thead>
            <tr>
              <th className="oil-th">Client</th>
              <th className="oil-th">Number</th>
              <th className="oil-th oil-th--right">Amount</th>
              <th className="oil-th">{dateLabel}</th>
              <th className="oil-th">Status</th>
              <th className="oil-th" />
            </tr>
          </thead>
          <tbody>
            {items.map(r => {
              const sm = STATUS_META[r._overdue ? 'overdue' : r.status] || STATUS_META.draft
              return (
                <tr key={r.id} className="oil-row" onClick={() => onRowClick(r)}>
                  <td className="oil-td oil-td--client">{r.clientName || '—'}</td>
                  <td className="oil-td oil-td--num">{r.invoiceNumber || '—'}</td>
                  <td className="oil-td oil-td--amount">{fmtMoney(r.total)}</td>
                  <td className="oil-td oil-td--date">{fmtDate(r[dateKey])}</td>
                  <td className="oil-td">
                    <span className="oil-badge" style={{ color: sm.color, background: sm.bg }}>
                      {sm.label}
                    </span>
                  </td>
                  <td className="oil-td oil-td--action">
                    <span className="oil-view-link">View →</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab wrapper ───────────────────────────────────────────────────────────────

export default function OrgInvoices() {
  const [tab, setTab] = useState('report')

  return (
    <div className="oi-root">
      <div className="oi-tabbar">
        <button
          className={`oi-tab${tab === 'report' ? ' oi-tab--active' : ''}`}
          onClick={() => setTab('report')}
        >
          📊 Sales Report
        </button>
        <button
          className={`oi-tab${tab === 'open' ? ' oi-tab--active' : ''}`}
          onClick={() => setTab('open')}
        >
          🧾 Invoices
        </button>
      </div>

      <div className="oi-content">
        {tab === 'report' ? <InvoiceReport embedded /> : <OrgInvoiceList />}
      </div>
    </div>
  )
}

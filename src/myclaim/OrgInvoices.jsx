import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, deleteDoc, collection, query, where } from 'firebase/firestore'
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
  const [loading, setLoading]       = useState(true)
  const [rows, setRows]             = useState([])
  const [orgId, setOrgId]           = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)
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

  async function doDelete(r) {
    if (!orgId) return
    setDeleting(true)
    try {
      const invId = r.invoiceId || r.id
      if (r.clientUid) {
        await deleteDoc(doc(db, 'users', r.clientUid, 'invoices', invId)).catch(() => {})
      } else if (r.clientDocId) {
        await deleteDoc(doc(db, 'organization_data', orgId, 'clients', r.clientDocId, 'invoices', invId)).catch(() => {})
      }
      await deleteDoc(doc(db, 'organization_data', orgId, 'invoice_summary', r.id))
      setRows(prev => prev.filter(x => x.id !== r.id))
      setConfirmDel(null)
    } finally {
      setDeleting(false)
    }
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
              onDelete={setConfirmDel}
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
              onDelete={setConfirmDel}
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
              onDelete={setConfirmDel}
              dateLabel="Issued"
              dateKey="issueDate"
            />
          )}
        </>
      )}
      {confirmDel && (
        <div className="oil-overlay" onClick={() => setConfirmDel(null)}>
          <div className="oil-modal" onClick={e => e.stopPropagation()}>
            <p className="oil-modal-title">Delete {confirmDel.type === 'estimate' ? 'Estimate' : 'Invoice'}?</p>
            <p className="oil-modal-body">
              {confirmDel.invoiceNumber} — {(confirmDel.total || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} will be permanently removed.
            </p>
            <div className="oil-modal-actions">
              <button className="oil-modal-cancel" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="oil-modal-delete" disabled={deleting} onClick={() => doDelete(confirmDel)}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, accent, accentBg, items, onRowClick, onDelete, dateLabel, dateKey }) {
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
                  <td className="oil-td oil-td--action" onClick={e => e.stopPropagation()}>
                    <button className="oil-action-btn" onClick={() => onRowClick(r)}>View</button>
                    <button className="oil-action-btn oil-action-btn--delete" onClick={() => onDelete(r)}>Delete</button>
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

// ── Partners Overview ─────────────────────────────────────────────────────────

function PartnersOverview() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading,   setLoading]   = useState(true)
  const [partners,  setPartners]  = useState([])
  const [statsMap,  setStatsMap]  = useState({}) // partnerId → { claims, submitted, settled, fee }

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return

      const [partnerSnap, settSnap] = await Promise.all([
        getDocs(collection(db, 'organization_data', oid, 'partners')),
        getDocs(collection(db, 'organization_data', oid, 'settlement_summary')).catch(() => ({ docs: [] })),
      ])

      // Build per-partner stats from settlement_summary
      const map = {}
      settSnap.docs.forEach(d => {
        const s = d.data()
        if (!s.partnerId) return
        if (!map[s.partnerId]) map[s.partnerId] = { claims: 0, submitted: 0, settled: 0, fee: 0 }
        const isSettled = (parseFloat(s.totalSettled) || 0) > 0
        map[s.partnerId].claims    += 1
        map[s.partnerId].submitted += parseFloat(s.totalEstimate) || 0
        if (isSettled) {
          map[s.partnerId].settled += parseFloat(s.totalSettled) || 0
          map[s.partnerId].fee     += parseFloat(s.partnerFee)   || 0
        }
      })

      setStatsMap(map)
      const list = partnerSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setPartners(list)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="po-loading"><div className="po-spinner" /></div>

  if (partners.length === 0) return (
    <div className="po-empty">
      <div className="po-empty-icon">🤝</div>
      <p className="po-empty-title">No partners yet</p>
      <p className="po-empty-sub">Add partners in Team Settings to track referral performance.</p>
    </div>
  )

  // Totals across all partners
  const allStats = Object.values(statsMap)
  const totalJobs    = allStats.reduce((s, x) => s + x.claims,    0)
  const totalSettled = allStats.reduce((s, x) => s + x.settled,   0)
  const totalFees    = allStats.reduce((s, x) => s + x.fee,       0)

  return (
    <div className="po-root">
      <div className="po-page-header">
        <div>
          <h2 className="po-title">Partner & Referral Network</h2>
          <p className="po-sub">
            {partners.length} partner{partners.length !== 1 ? 's' : ''} · {totalJobs} referred job{totalJobs !== 1 ? 's' : ''} · {fmtMoney(totalFees)} in referral fees paid
          </p>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {totalJobs > 0 && (
        <div className="po-kpi-row">
          <div className="po-kpi">
            <div className="po-kpi-label">Total Referred Jobs</div>
            <div className="po-kpi-val">{totalJobs}</div>
          </div>
          <div className="po-kpi po-kpi--green">
            <div className="po-kpi-label">Total Settled</div>
            <div className="po-kpi-val">{fmtMoney(totalSettled)}</div>
          </div>
          <div className="po-kpi po-kpi--purple">
            <div className="po-kpi-label">Referral Fees Paid</div>
            <div className="po-kpi-val">{fmtMoney(totalFees)}</div>
          </div>
          <div className="po-kpi po-kpi--blue">
            <div className="po-kpi-label">Company Net</div>
            <div className="po-kpi-val">{fmtMoney(totalSettled - totalFees)}</div>
          </div>
        </div>
      )}

      {/* ── Partner cards ── */}
      <div className="po-grid">
        {partners.map(p => {
          const st  = statsMap[p.id] || { claims: 0, submitted: 0, settled: 0, fee: 0 }
          const net = st.settled - st.fee
          const hasJobs = st.claims > 0

          return (
            <div key={p.id} className="po-card" onClick={() => navigate(`/myclaim/partners/${p.id}`)}>
              <div className="po-card-head">
                <div className="po-avatar">👤</div>
                <div className="po-card-name-wrap">
                  <div className="po-card-name">{p.name}</div>
                  {p.email && <div className="po-card-contact">{p.email}</div>}
                  {p.phone && <div className="po-card-contact">{p.phone}</div>}
                </div>
                <span className="po-arrow">→</span>
              </div>

              {hasJobs ? (
                <div className="po-card-stats">
                  <div className="po-stat">
                    <span className="po-stat-label">Jobs</span>
                    <span className="po-stat-val">{st.claims}</span>
                  </div>
                  <div className="po-stat">
                    <span className="po-stat-label">Submitted</span>
                    <span className="po-stat-val">{fmtMoney(st.submitted)}</span>
                  </div>
                  <div className="po-stat">
                    <span className="po-stat-label">Settled</span>
                    <span className="po-stat-val" style={{ color: '#15803d' }}>{fmtMoney(st.settled)}</span>
                  </div>
                  <div className="po-stat">
                    <span className="po-stat-label">Fees Paid</span>
                    <span className="po-stat-val" style={{ color: '#7c3aed' }}>{st.fee > 0 ? fmtMoney(st.fee) : '—'}</span>
                  </div>
                  <div className="po-stat">
                    <span className="po-stat-label">Co. Net</span>
                    <span className="po-stat-val" style={{ color: '#1d4ed8', fontWeight: 700 }}>{fmtMoney(net)}</span>
                  </div>
                </div>
              ) : (
                <p className="po-card-no-jobs">No jobs referred yet</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab wrapper ───────────────────────────────────────────────────────────────

export default function OrgInvoices() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab')
    return ['report', 'open', 'partners'].includes(t) ? t : 'report'
  })

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
        <button
          className={`oi-tab${tab === 'partners' ? ' oi-tab--active' : ''}`}
          onClick={() => setTab('partners')}
        >
          🤝 Partners
        </button>
      </div>

      <div className="oi-content">
        {tab === 'report'   && <InvoiceReport embedded />}
        {tab === 'open'     && <OrgInvoiceList />}
        {tab === 'partners' && <PartnersOverview />}
      </div>
    </div>
  )
}

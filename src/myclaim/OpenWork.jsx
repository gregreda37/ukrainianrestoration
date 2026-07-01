import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, deleteDoc, collection } from 'firebase/firestore'
import { useAuth } from './useAuth'
import './OrgInvoices.css'

const SETT_CATS = [
  { key: 'dryClean',       label: 'Dry Cleaning' },
  { key: 'mitigation',     label: 'Mitigation'   },
  { key: 'reconstruction', label: 'Reconstruction' },
  { key: 'packout',        label: 'Packout' },
]

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function SettlementPaymentsSection({ items, total, navigate }) {
  const [view, setView] = useState('full')

  const coNetTotal = items.reduce((sum, s) => {
    const settled = parseFloat(s.totalSettled)    || 0
    const fee     = parseFloat(s.partnerFee)      || 0
    const paid    = parseFloat(s.totalPaidAmount) || 0
    const coNet   = Math.max(0, settled - fee)
    return sum + Math.max(0, coNet - paid)
  }, 0)

  const displayTotal = view === 'net' ? coNetTotal : total

  return (
    <div className="oil-section">
      <div className="oil-section-header" style={{ borderLeftColor: '#d97706' }}>
        <div className="oil-section-left">
          <span className="oil-section-title" style={{ color: '#d97706' }}>⏳ Awaiting Settlement Payment</span>
          <span className="oil-section-count" style={{ background: '#fffbeb', color: '#d97706' }}>
            {items.length}
          </span>
          <div className="oil-sett-view-tabs">
            <button
              className={`oil-sett-tab${view === 'full' ? ' oil-sett-tab--active' : ''}`}
              onClick={() => setView('full')}
            >
              Full Settlement
            </button>
            <button
              className={`oil-sett-tab${view === 'net' ? ' oil-sett-tab--active' : ''}`}
              onClick={() => setView('net')}
            >
              Co. Receivables
            </button>
          </div>
        </div>
        <span className="oil-section-total">
          {fmtMoney(displayTotal)}
          <span className="oil-sett-total-label">
            {view === 'net' ? ' co. outstanding' : ' outstanding'}
          </span>
        </span>
      </div>

      <div className="oil-table-wrap">
        {view === 'full' ? (
          <table className="oil-table">
            <thead>
              <tr>
                <th className="oil-th">Client</th>
                <th className="oil-th">Claim #</th>
                <th className="oil-th">Insurance Co.</th>
                <th className="oil-th oil-th--right">Settled</th>
                <th className="oil-th oil-th--right">Received</th>
                <th className="oil-th oil-th--right">Outstanding</th>
                <th className="oil-th">Date Settled</th>
                <th className="oil-th" />
              </tr>
            </thead>
            <tbody>
              {items.map(s => {
                const settled     = parseFloat(s.totalSettled)     || 0
                const totalPaid   = parseFloat(s.totalPaidAmount)  || 0
                const outstanding = parseFloat(s.totalOutstanding) ?? Math.max(0, settled - totalPaid)
                const href = s.clientPhone
                  ? `/myclaim/clients/${encodeURIComponent(s.clientPhone)}/settlement`
                  : null
                return (
                  <tr key={s.id} className={`oil-row${href ? '' : ' oil-row--no-link'}`} onClick={href ? () => navigate(href) : undefined}>
                    <td className="oil-td oil-td--client">{s.clientName || '—'}</td>
                    <td className="oil-td oil-td--num">{s.claimNumber || '—'}</td>
                    <td className="oil-td">{s.insuranceCompany || '—'}</td>
                    <td className="oil-td oil-td--amount">{fmtMoney(settled)}</td>
                    <td className="oil-td oil-td--amount" style={{ color: totalPaid > 0 ? '#0891b2' : '#94a3b8' }}>
                      {totalPaid > 0 ? fmtMoney(totalPaid) : '—'}
                    </td>
                    <td className="oil-td oil-td--amount">
                      <span className="oil-outstanding-val">{fmtMoney(outstanding)}</span>
                    </td>
                    <td className="oil-td oil-td--date">{fmtDate(s.settlementDate)}</td>
                    <td className="oil-td" style={{ color: href ? '#2563eb' : '#94a3b8', fontSize: 13, textAlign: 'right' }}>
                      {href ? '→' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="oil-total-row">
                <td colSpan={3} />
                <td className="oil-td oil-td--amount"><strong>{fmtMoney(items.reduce((s2, r) => s2 + (parseFloat(r.totalSettled) || 0), 0))}</strong></td>
                <td className="oil-td oil-td--amount" style={{ color: '#0891b2' }}><strong>{fmtMoney(items.reduce((s2, r) => s2 + (parseFloat(r.totalPaidAmount) || 0), 0))}</strong></td>
                <td className="oil-td oil-td--amount"><strong className="oil-outstanding-val">{fmtMoney(total)}</strong></td>
                <td /><td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="oil-table">
            <thead>
              <tr>
                <th className="oil-th">Client</th>
                <th className="oil-th">Claim #</th>
                <th className="oil-th oil-th--right">Settled</th>
                <th className="oil-th oil-th--right">Referral Fee</th>
                <th className="oil-th oil-th--right">Co. Net (after referral fee)</th>
                <th className="oil-th oil-th--right">Received</th>
                <th className="oil-th oil-th--right">Co. Outstanding</th>
                <th className="oil-th" />
              </tr>
            </thead>
            <tbody>
              {items.map(s => {
                const settled  = parseFloat(s.totalSettled)    || 0
                const fee      = parseFloat(s.partnerFee)      || 0
                const paid     = parseFloat(s.totalPaidAmount) || 0
                const coNet    = Math.max(0, settled - fee)
                const coOuts   = Math.max(0, coNet - paid)
                const href = s.clientPhone
                  ? `/myclaim/clients/${encodeURIComponent(s.clientPhone)}/settlement`
                  : null
                return (
                  <tr key={s.id} className={`oil-row${href ? '' : ' oil-row--no-link'}`} onClick={href ? () => navigate(href) : undefined}>
                    <td className="oil-td oil-td--client">
                      <div>{s.clientName || '—'}</div>
                      {fee > 0 && (
                        <span className="oil-fee-basis-chip">
                          fee {s.partnerFeeOnNet ? 'on net' : 'on gross'}
                        </span>
                      )}
                    </td>
                    <td className="oil-td oil-td--num">{s.claimNumber || '—'}</td>
                    <td className="oil-td oil-td--amount">{fmtMoney(settled)}</td>
                    <td className="oil-td oil-td--amount" style={{ color: fee > 0 ? '#7c3aed' : '#94a3b8' }}>
                      {fee > 0 ? `– ${fmtMoney(fee)}` : '—'}
                    </td>
                    <td className="oil-td oil-td--amount" style={{ color: '#0f172a', fontWeight: 700 }}>
                      {fmtMoney(coNet)}
                    </td>
                    <td className="oil-td oil-td--amount" style={{ color: paid > 0 ? '#0891b2' : '#94a3b8' }}>
                      {paid > 0 ? fmtMoney(paid) : '—'}
                    </td>
                    <td className="oil-td oil-td--amount">
                      <span className="oil-outstanding-val">{fmtMoney(coOuts)}</span>
                    </td>
                    <td className="oil-td" style={{ color: href ? '#2563eb' : '#94a3b8', fontSize: 13, textAlign: 'right' }}>
                      {href ? '→' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="oil-total-row">
                <td colSpan={2} />
                <td className="oil-td oil-td--amount"><strong>{fmtMoney(items.reduce((s2, r) => s2 + (parseFloat(r.totalSettled) || 0), 0))}</strong></td>
                <td className="oil-td oil-td--amount" style={{ color: '#7c3aed' }}><strong>– {fmtMoney(items.reduce((s2, r) => s2 + (parseFloat(r.partnerFee) || 0), 0))}</strong></td>
                <td className="oil-td oil-td--amount"><strong>{fmtMoney(items.reduce((s2, r) => s2 + Math.max(0, (parseFloat(r.totalSettled) || 0) - (parseFloat(r.partnerFee) || 0)), 0))}</strong></td>
                <td className="oil-td oil-td--amount" style={{ color: '#0891b2' }}><strong>{fmtMoney(items.reduce((s2, r) => s2 + (parseFloat(r.totalPaidAmount) || 0), 0))}</strong></td>
                <td className="oil-td oil-td--amount"><strong className="oil-outstanding-val">{fmtMoney(coNetTotal)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function PaidInvoicesSection({ items, total, goTo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="oil-section">
      <div
        className="oil-section-header oil-section-header--clickable"
        style={{ borderLeftColor: '#16a34a' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="oil-section-left">
          <span className="oil-section-title" style={{ color: '#16a34a' }}>✓ Paid Invoices</span>
          <span className="oil-section-count" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            {items.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="oil-section-total" style={{ color: '#16a34a' }}>{fmtMoney(total)}</span>
          <span className="oil-section-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="oil-table-wrap">
          <table className="oil-table">
            <thead>
              <tr>
                <th className="oil-th">Client</th>
                <th className="oil-th">Invoice #</th>
                <th className="oil-th oil-th--right">Amount</th>
                <th className="oil-th">Date Paid</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} className="oil-row" onClick={() => goTo(r)}>
                  <td className="oil-td oil-td--client">{r.clientName || '—'}</td>
                  <td className="oil-td oil-td--num">{r.invoiceNumber || '—'}</td>
                  <td className="oil-td oil-td--amount" style={{ color: '#16a34a' }}>{fmtMoney(r.total)}</td>
                  <td className="oil-td oil-td--date">{fmtDate(r.paidDate || r.updatedAt || r.issueDate)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="oil-total-row">
                <td colSpan={2} />
                <td className="oil-td oil-td--amount"><strong style={{ color: '#16a34a' }}>{fmtMoney(total)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
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

export default function OpenWork() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading]       = useState(true)
  const [rows, setRows]             = useState([])
  const [settRows, setSettRows]     = useState([])
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
      const [invSnap, settSnap] = await Promise.all([
        getDocs(collection(db, 'organization_data', oid, 'invoice_summary')),
        getDocs(collection(db, 'organization_data', oid, 'settlement_summary')).catch(() => ({ docs: [] })),
      ])
      setRows(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      const rawSetts = settSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const missing  = rawSetts.filter(s => !s.clientPhone && (s.clientDocId || s.clientUid))
      let phoneMap   = {}
      if (missing.length > 0) {
        const fetches = missing.map(s =>
          s.clientDocId
            ? getDoc(doc(db, 'organization_data', oid, 'clients', s.clientDocId))
            : getDoc(doc(db, 'users', s.clientUid))
        )
        const snaps = await Promise.all(fetches)
        missing.forEach((s, i) => {
          const data = snaps[i].data()
          const phone = data?.phone || data?.phoneNumber || null
          if (phone) phoneMap[s.id] = phone
        })
      }
      setSettRows(rawSetts.map(s => phoneMap[s.id] ? { ...s, clientPhone: phoneMap[s.id] } : s))
    } finally {
      setLoading(false)
    }
  }

  const today = todayStr()

  const { overdue, openInvoices, estimates, paidInvoices } = useMemo(() => {
    const overdue      = []
    const openInvoices = []
    const estimates    = []
    const paidInvoices = []

    for (const r of rows) {
      if (r.type === 'receipt') continue
      if (['cancelled', 'converted'].includes(r.status)) continue

      if (r.status === 'paid' && r.type === 'invoice') {
        paidInvoices.push(r)
        continue
      }

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
    paidInvoices.sort((a, b) => (a.paidDate || a.issueDate || '') > (b.paidDate || b.issueDate || '') ? -1 : 1)

    return { overdue, openInvoices, estimates, paidInvoices }
  }, [rows, today])

  const totalReceivable = [...overdue, ...openInvoices].reduce((s, r) => s + (r.total || 0), 0)
  const totalOverdue    = overdue.reduce((s, r) => s + (r.total || 0), 0)
  const totalEstimates  = estimates.reduce((s, r) => s + (r.total || 0), 0)
  const totalCollected  = paidInvoices.reduce((s, r) => s + (r.total || 0), 0)

  const awaitingSettlements = useMemo(() => {
    return settRows
      .filter(s => (parseFloat(s.totalSettled) || 0) > 0 && !s.paid)
      .sort((a, b) => (a.settlementDate || '') < (b.settlementDate || '') ? -1 : 1)
  }, [settRows])

  const awaitingSettlementTotal = awaitingSettlements.reduce((sum, s) => {
    const settled     = parseFloat(s.totalSettled)     || 0
    const totalPaid   = parseFloat(s.totalPaidAmount)  || 0
    const outstanding = parseFloat(s.totalOutstanding) ?? (settled - totalPaid)
    return sum + Math.max(0, outstanding)
  }, 0)

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
    <div className="oil-root" style={{ maxWidth: 1100 }}>
      <div className="oil-page-header">
        <div>
          <h2 className="oil-title">Open Work</h2>
          <p className="oil-sub">All outstanding invoices &amp; estimates across every client</p>
        </div>
      </div>

      <div className="oil-kpi-row oil-kpi-row--4">
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
        <div className="oil-kpi oil-kpi--green">
          <div className="oil-kpi-label">Total Collected</div>
          <div className="oil-kpi-val">{fmtMoney(totalCollected)}</div>
          <div className="oil-kpi-sub">{paidInvoices.length} paid invoice{paidInvoices.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {isEmpty && awaitingSettlements.length === 0 ? (
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
          {awaitingSettlements.length > 0 && (
            <SettlementPaymentsSection
              items={awaitingSettlements}
              total={awaitingSettlementTotal}
              navigate={navigate}
            />
          )}
        </>
      )}
      {paidInvoices.length > 0 && (
        <PaidInvoicesSection items={paidInvoices} total={totalCollected} goTo={goTo} />
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

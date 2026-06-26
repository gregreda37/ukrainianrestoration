import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection, query, orderBy } from 'firebase/firestore'
import { useAuth } from './useAuth'
import './InvoiceReport.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmtMoney(n, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getYear(inv)    { return inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').getFullYear() : null }
function getMonth(inv)   { return inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').getMonth()    : null }
function getQuarter(inv) { const m = getMonth(inv); return m === null ? null : Math.floor(m / 3) + 1 }

function isOverdue(inv) {
  if (inv.status === 'paid' || inv.status === 'cancelled' || inv.type !== 'invoice') return false
  if (!inv.dueDate) return false
  return new Date(inv.dueDate + 'T23:59:59') < new Date()
}

function daysOverdue(dueDate) {
  if (!dueDate) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dueDate + 'T12:00:00').getTime()) / 86400000))
}

function ageGroup(inv) {
  if (!isOverdue(inv)) return 'current'
  const d = daysOverdue(inv.dueDate)
  if (d <= 30)  return '1-30'
  if (d <= 60)  return '31-60'
  if (d <= 90)  return '61-90'
  return '90+'
}

function clientStatus(invoices) {
  if (!invoices.length) return 'none'
  if (invoices.some(i => isOverdue(i))) return 'overdue'
  if (invoices.every(i => i.status === 'paid')) return 'paid'
  if (invoices.some(i => i.status === 'paid')) return 'partial'
  if (invoices.some(i => i.status === 'sent')) return 'awaiting'
  return 'draft'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceReport() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [summaries,    setSummaries]    = useState([])
  const [settlements,  setSettlements]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [orgId,        setOrgId]        = useState('')
  const [orgName,      setOrgName]      = useState('')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedQ,    setSelectedQ]    = useState(null) // null = full year

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const orgSnap = await getDoc(doc(db, 'organization_data', oid))
      if (orgSnap.exists()) setOrgName(orgSnap.data().companyName || '')

      const [invSnap, settSnap] = await Promise.all([
        getDocs(collection(db, 'organization_data', oid, 'invoice_summary')),
        getDocs(collection(db, 'organization_data', oid, 'settlement_summary')),
      ])
      setSummaries(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setSettlements(settSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

  // ── Available years ──
  const availableYears = useMemo(() => {
    const years = new Set(summaries.map(s => getYear(s)).filter(Boolean))
    const cur = new Date().getFullYear()
    years.add(cur); years.add(cur - 1)
    return Array.from(years).sort((a, b) => b - a)
  }, [summaries])

  // ── Filtered: invoices only (not estimates) for revenue metrics ──
  const filtered = useMemo(() => summaries.filter(s => {
    if (s.type !== 'invoice') return false
    if (getYear(s) !== selectedYear) return false
    if (selectedQ && getQuarter(s) !== selectedQ) return false
    return true
  }), [summaries, selectedYear, selectedQ])

  // ── All estimates ──
  const allEstimates = useMemo(() =>
    summaries.filter(s => s.type === 'estimate'), [summaries])

  // ── KPIs ──
  const totalBilled    = filtered.reduce((s, i) => s + (i.total || 0), 0)
  const totalCollected = filtered.reduce((s, i) => s + (i.paidAmount || 0), 0)
  const outstanding    = totalBilled - totalCollected
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled * 100) : 0

  // ── All invoices for pipeline (ignore year filter for overdue alerts) ──
  const allInvoices = summaries.filter(s => s.type === 'invoice')
  const overdueList  = allInvoices.filter(i => isOverdue(i))
  const awaitingList = allInvoices.filter(i => !isOverdue(i) && i.status === 'sent')
  const draftList    = allInvoices.filter(i => i.status === 'draft')
  const openEstimates = allEstimates.filter(i => i.status === 'draft' || i.status === 'sent')

  // ── Monthly data (full year only) ──
  const monthlyData = useMemo(() => {
    if (selectedQ) return []
    return MONTHS.map((_, m) => {
      const invs = filtered.filter(i => getMonth(i) === m)
      return {
        billed:    invs.reduce((s, i) => s + (i.total || 0), 0),
        collected: invs.reduce((s, i) => s + (i.paidAmount || 0), 0),
        count:     invs.length,
      }
    })
  }, [filtered, selectedQ])

  const maxMonthly = Math.max(...monthlyData.map(m => m.billed), 1)

  // ── Quarterly summary ──
  const quarterlyData = useMemo(() => [1, 2, 3, 4].map(q => {
    const qInvs = summaries.filter(s => s.type === 'invoice' && getYear(s) === selectedYear && getQuarter(s) === q)
    const billed    = qInvs.reduce((s, i) => s + (i.total || 0), 0)
    const collected = qInvs.reduce((s, i) => s + (i.paidAmount || 0), 0)
    return { q, count: qInvs.length, billed, collected, outstanding: billed - collected, rate: billed > 0 ? collected / billed * 100 : 0 }
  }), [summaries, selectedYear])

  // ── Aging buckets (all-time outstanding) ──
  const aging = useMemo(() => {
    const groups = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] }
    allInvoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .forEach(i => groups[ageGroup(i)].push(i))
    return groups
  }, [allInvoices])

  const agingRows = [
    { key: 'current', label: 'Current (not yet due)',   color: '#16a34a' },
    { key: '1-30',    label: '1–30 days overdue',        color: '#d97706' },
    { key: '31-60',   label: '31–60 days overdue',       color: '#ea580c' },
    { key: '61-90',   label: '61–90 days overdue',       color: '#dc2626' },
    { key: '90+',     label: '90+ days overdue',         color: '#7f1d1d' },
  ]

  // ── Per-client breakdown ──
  const clientRows = useMemo(() => {
    const map = {}
    allInvoices.forEach(inv => {
      const key = inv.clientUid || inv.clientPhone || inv.clientName
      if (!map[key]) map[key] = { name: inv.clientName, phone: inv.clientPhone, uid: inv.clientUid, invoices: [] }
      map[key].invoices.push(inv)
    })
    return Object.values(map).map(c => {
      const billed    = c.invoices.reduce((s, i) => s + (i.total || 0), 0)
      const collected = c.invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
      const paidInvs  = c.invoices.filter(i => i.status === 'paid' && i.issueDate && i.paidAt?.toDate)
      const avgDays   = paidInvs.length
        ? Math.round(paidInvs.reduce((s, i) => s + (i.paidAt.toDate() - new Date(i.issueDate + 'T12:00:00')) / 86400000, 0) / paidInvs.length)
        : null
      const status = clientStatus(c.invoices)
      return { ...c, billed, collected, outstanding: billed - collected, avgDays, status, count: c.invoices.length }
    }).sort((a, b) => b.outstanding - a.outstanding)
  }, [allInvoices])

  // ── Estimate conversion ──
  const estTotal     = allEstimates.length
  const estConverted = allEstimates.filter(e => e.status === 'converted').length
  const estRate      = estTotal > 0 ? Math.round(estConverted / estTotal * 100) : 0

  // ── Average days to payment ──
  const paidWithDates = allInvoices.filter(i => i.status === 'paid' && i.issueDate && i.paidAt?.toDate)
  const avgDaysPay = paidWithDates.length
    ? Math.round(paidWithDates.reduce((s, i) => s + (i.paidAt.toDate() - new Date(i.issueDate + 'T12:00:00')) / 86400000, 0) / paidWithDates.length)
    : null

  // ── Insights ──
  const insights = useMemo(() => {
    const list = []
    if (overdueList.length) {
      const amt = overdueList.reduce((s, i) => s + ((i.total || 0) - (i.paidAmount || 0)), 0)
      list.push({ icon: '⚠️', color: '#dc2626', bg: '#fef2f2', text: `${overdueList.length} invoice${overdueList.length > 1 ? 's are' : ' is'} overdue totaling ${fmtMoney(amt)} — prioritize follow-up.` })
    }
    if (collectionRate >= 90)      list.push({ icon: '✅', color: '#15803d', bg: '#dcfce7', text: `Collection rate is ${collectionRate.toFixed(0)}% — excellent billing health.` })
    else if (collectionRate >= 70) list.push({ icon: '📊', color: '#d97706', bg: '#fffbeb', text: `Collection rate is ${collectionRate.toFixed(0)}% — room to improve follow-up cadence.` })
    else if (collectionRate > 0)   list.push({ icon: '🔴', color: '#dc2626', bg: '#fef2f2', text: `Collection rate is only ${collectionRate.toFixed(0)}% — review outstanding invoices urgently.` })

    const bestQ = [...quarterlyData].sort((a, b) => b.billed - a.billed)[0]
    if (bestQ?.billed > 0) list.push({ icon: '📈', color: '#2563eb', bg: '#eff6ff', text: `Best quarter: Q${bestQ.q} with ${fmtMoney(bestQ.billed)} billed.` })

    const topClient = clientRows[0]
    if (topClient?.billed > 0) list.push({ icon: '🏆', color: '#7c3aed', bg: '#f5f3ff', text: `Top outstanding client: ${topClient.name} (${fmtMoney(topClient.outstanding)} owed of ${fmtMoney(topClient.billed)} billed).` })

    if (estTotal > 0) list.push({ icon: '📋', color: '#0891b2', bg: '#ecfeff', text: `Estimate conversion rate: ${estRate}% (${estConverted} of ${estTotal} estimates became invoices).` })
    if (avgDaysPay !== null) list.push({ icon: '⏱', color: '#475569', bg: '#f8fafc', text: `Average days to payment: ${avgDaysPay} days.` })

    return list
  }, [overdueList, collectionRate, quarterlyData, clientRows, estTotal, estConverted, estRate, avgDaysPay])

  // ── Settlement metrics ────────────────────────────────────────────────────

  const sn = v => parseFloat(v) || 0

  // Filter settlements by settlementDate matching selected year/quarter
  const filteredSettlements = settlements.filter(s => {
    if (!s.settlementDate) return true // undated settlements always show
    const d = new Date(s.settlementDate + 'T12:00:00')
    if (d.getFullYear() !== selectedYear) return false
    if (selectedQ && Math.floor(d.getMonth() / 3) + 1 !== selectedQ) return false
    return true
  })

  const settTotalSubmitted    = filteredSettlements.reduce((s, x) => s + sn(x.totalEstimate), 0)
  const settTotalSettled      = filteredSettlements.reduce((s, x) => s + sn(x.totalSettled),  0)
  const settTotalGap          = filteredSettlements.reduce((s, x) => s + sn(x.gap),           0)
  const settTotalRecoup       = filteredSettlements.reduce((s, x) => s + sn(x.companyRecoup), 0)
  const settAvgRecovery       = settTotalSubmitted > 0 ? settTotalSettled / settTotalSubmitted * 100 : 0

  const settCatData = [
    {
      label: 'Dry Cleaning / Contents',
      submitted: filteredSettlements.reduce((s, x) => s + sn(x.dryCleanEstimate), 0),
      settled:   filteredSettlements.reduce((s, x) => s + sn(x.dryCleanSettled),  0),
    },
    {
      label: 'Mitigation',
      submitted: filteredSettlements.reduce((s, x) => s + sn(x.mitigationEstimate), 0),
      settled:   filteredSettlements.reduce((s, x) => s + sn(x.mitigationSettled),  0),
    },
    {
      label: 'Reconstruction',
      submitted: filteredSettlements.reduce((s, x) => s + sn(x.reconstructionEstimate), 0),
      settled:   filteredSettlements.reduce((s, x) => s + sn(x.reconstructionSettled),  0),
    },
  ]

  const recoupBuckets = [
    { label: 'Full Recoup (100%)',   color: '#15803d', bg: '#dcfce7', items: filteredSettlements.filter(s => sn(s.recoupPercent) === 100) },
    { label: 'Shared (50–99%)',      color: '#d97706', bg: '#fffbeb', items: filteredSettlements.filter(s => { const r = sn(s.recoupPercent); return r >= 50 && r < 100 }) },
    { label: 'Minority Split (<50%)',color: '#dc2626', bg: '#fef2f2', items: filteredSettlements.filter(s => sn(s.recoupPercent) < 50 && sn(s.recoupPercent) > 0) },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="ir-loading">Loading report…</div>

  if (summaries.length === 0) {
    return (
      <div className="ir-root">
        <div className="ir-empty-state">
          <div className="ir-empty-icon">📊</div>
          <h2 className="ir-empty-title">No invoice data yet</h2>
          <p className="ir-empty-sub">Create your first invoice or estimate to start seeing reports.</p>
          <button className="ir-btn ir-btn--primary" onClick={() => navigate('/myclaim/clients')}>
            Go to Clients
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ir-root">
      {/* ── Header ── */}
      <div className="ir-header no-print-hide">
        <div>
          <h1 className="ir-title">Company Sales Report</h1>
          <p className="ir-sub">{orgName} — cash jobs &amp; insurance settlements</p>
        </div>
        <div className="ir-header-right">
          <select className="ir-year-select" value={selectedYear}
            onChange={e => { setSelectedYear(Number(e.target.value)); setSelectedQ(null) }}>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="ir-btn ir-btn--outline" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {/* ── Quarter filter ── */}
      <div className="ir-qfilter no-print-hide">
        {[null, 1, 2, 3, 4].map(q => (
          <button key={String(q)} className={`ir-qbtn${selectedQ === q ? ' ir-qbtn--active' : ''}`}
            onClick={() => setSelectedQ(q)}>
            {q === null ? 'Full Year' : `Q${q}`}
          </button>
        ))}
      </div>

      {/* ── Combined company sales ── */}
      {(() => {
        const totalRevenue = totalCollected + settTotalRecoup
        const cashPct      = totalRevenue > 0 ? totalCollected    / totalRevenue * 100 : 0
        const insPct       = totalRevenue > 0 ? settTotalRecoup   / totalRevenue * 100 : 0
        const hasBoth      = totalCollected > 0 && settTotalRecoup > 0
        return (
          <div className="ir-combined-block">
            <div className="ir-combined-label">Total Company Sales — {selectedYear}{selectedQ ? ` Q${selectedQ}` : ''}</div>
            <div className="ir-combined-hero">{fmtMoney(totalRevenue)}</div>
            <div className="ir-combined-sub">
              {filtered.length} cash job{filtered.length !== 1 ? 's' : ''}
              {filteredSettlements.length > 0 && ` · ${filteredSettlements.length} insurance claim${filteredSettlements.length !== 1 ? 's' : ''}`}
            </div>

            {totalRevenue > 0 && (
              <>
                <div className="ir-split-bar">
                  {totalCollected > 0 && (
                    <div className="ir-split-seg ir-split-seg--cash"
                      style={{ flex: totalCollected }}
                      title={`Cash: ${fmtMoney(totalCollected)}`} />
                  )}
                  {settTotalRecoup > 0 && (
                    <div className="ir-split-seg ir-split-seg--ins"
                      style={{ flex: settTotalRecoup }}
                      title={`Insurance recoup: ${fmtMoney(settTotalRecoup)}`} />
                  )}
                </div>
                <div className="ir-split-legend">
                  {totalCollected > 0 && (
                    <span className="ir-split-item">
                      <span className="ir-split-dot ir-split-dot--cash" />
                      Cash Jobs — {cashPct.toFixed(0)}% · {fmtMoney(totalCollected)}
                    </span>
                  )}
                  {settTotalRecoup > 0 && (
                    <span className="ir-split-item">
                      <span className="ir-split-dot ir-split-dot--ins" />
                      Insurance Recoup — {insPct.toFixed(0)}% · {fmtMoney(settTotalRecoup)}
                    </span>
                  )}
                  {outstanding > 0 && (
                    <span className="ir-split-item ir-split-item--pending">
                      <span className="ir-split-dot ir-split-dot--pending" />
                      Pending Collection · {fmtMoney(outstanding)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── Insurance settlement performance ── */}
      {filteredSettlements.length > 0 && (
        <div className="ir-section ir-section--settlement">
          <div className="ir-stream-label">🏛️ Insurance Job Detail</div>
          <div className="ir-section-title-row">
            <div className="ir-section-title">Settlement Performance</div>
            <div className="ir-section-sub">{filteredSettlements.length} claim{filteredSettlements.length !== 1 ? 's' : ''} tracked</div>
          </div>

          {/* Settlement KPIs */}
          <div className="ir-kpi-row ir-kpi-row--5">
            <KPICard label="Total Submitted"   value={fmtMoney(settTotalSubmitted)} sub="to insurance"           color="#0f172a" />
            <KPICard label="Total Settled"     value={fmtMoney(settTotalSettled)}   sub={`${settAvgRecovery.toFixed(1)}% recovery`} color="#16a34a" />
            <KPICard label="Written Off"       value={fmtMoney(settTotalGap)}       sub="uncollected gap"        color={settTotalGap > 0 ? '#dc2626' : '#94a3b8'} />
            <KPICard label="Company Recoup"    value={fmtMoney(settTotalRecoup)}    sub="after partner splits"   color="#2563eb" />
            <KPICard label="Left with Partner" value={fmtMoney(settTotalSettled - settTotalRecoup)} sub="split away" color="#7c3aed" />
          </div>

          {/* Category breakdown */}
          {settCatData.some(c => c.submitted > 0) && (
            <table className="ir-table ir-table--settlement">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="ir-num">Submitted</th>
                  <th className="ir-num">Settled</th>
                  <th className="ir-num">Gap</th>
                  <th className="ir-num">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {settCatData.map(cat => {
                  const gap = Math.max(0, cat.submitted - cat.settled)
                  const rate = cat.submitted > 0 ? cat.settled / cat.submitted * 100 : 0
                  return (
                    <tr key={cat.label}>
                      <td>{cat.label}</td>
                      <td className="ir-num">{cat.submitted > 0 ? fmtMoney(cat.submitted) : '—'}</td>
                      <td className="ir-num" style={{ color: '#16a34a' }}>{cat.settled > 0 ? fmtMoney(cat.settled) : '—'}</td>
                      <td className="ir-num" style={{ color: gap > 0 ? '#dc2626' : '#94a3b8' }}>
                        {gap > 0 ? `– ${fmtMoney(gap)}` : '—'}
                      </td>
                      <td className="ir-num">
                        {cat.submitted > 0 ? (
                          <span className="ir-rate-pill" style={{
                            color: rate >= 90 ? '#15803d' : rate >= 75 ? '#92400e' : '#991b1b',
                            background: rate >= 90 ? '#dcfce7' : rate >= 75 ? '#fef9c3' : '#fee2e2',
                          }}>{rate.toFixed(1)}%</span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="ir-total-row">
                  <td><strong>Total</strong></td>
                  <td className="ir-num ir-bold">{fmtMoney(settTotalSubmitted)}</td>
                  <td className="ir-num" style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(settTotalSettled)}</td>
                  <td className="ir-num" style={{ color: settTotalGap > 0 ? '#dc2626' : '#94a3b8', fontWeight: 700 }}>
                    {settTotalGap > 0 ? `– ${fmtMoney(settTotalGap)}` : '—'}
                  </td>
                  <td className="ir-num">
                    <span className="ir-rate-pill" style={{
                      color: settAvgRecovery >= 90 ? '#15803d' : settAvgRecovery >= 75 ? '#92400e' : '#991b1b',
                      background: settAvgRecovery >= 90 ? '#dcfce7' : settAvgRecovery >= 75 ? '#fef9c3' : '#fee2e2',
                    }}>{settAvgRecovery.toFixed(1)}%</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Recoup distribution */}
          <div className="ir-section-label-sm">Profit Recoup Distribution</div>
          <div className="ir-recoup-buckets">
            {recoupBuckets.map(b => {
              const amt = b.items.reduce((s, x) => s + sn(x.companyRecoup), 0)
              const pct = settTotalRecoup > 0 ? amt / settTotalRecoup * 100 : 0
              return (
                <div key={b.label} className="ir-recoup-bucket" style={{ background: b.bg }}>
                  <div className="ir-recoup-bucket-label" style={{ color: b.color }}>{b.label}</div>
                  <div className="ir-recoup-bucket-count">{b.items.length} claim{b.items.length !== 1 ? 's' : ''}</div>
                  <div className="ir-recoup-bucket-amt" style={{ color: b.color }}>{fmtMoney(amt)}</div>
                  <div className="ir-recoup-bar-wrap">
                    <div className="ir-recoup-bar-fill" style={{ width: `${pct}%`, background: b.color }} />
                  </div>
                  <div className="ir-recoup-bucket-pct" style={{ color: b.color }}>{pct.toFixed(0)}% of recoup</div>
                </div>
              )
            })}
          </div>

          {/* Per-claim table */}
          <div className="ir-section-label-sm" style={{ marginTop: 18 }}>Claim Detail</div>
          <table className="ir-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Claim #</th>
                <th>Insurer</th>
                <th className="ir-num">Submitted</th>
                <th className="ir-num">Settled</th>
                <th className="ir-num">Recoup %</th>
                <th className="ir-num">Co. Net</th>
                <th className="ir-num">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...filteredSettlements].sort((a, b) => sn(b.totalEstimate) - sn(a.totalEstimate)).map(s => {
                const rate = sn(s.recoveryRate)
                const rp   = sn(s.recoupPercent) || 100
                return (
                  <tr key={s.id}>
                    <td>{s.clientName || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.claimNumber || '—'}</td>
                    <td style={{ color: '#64748b' }}>{s.insuranceCompany || '—'}</td>
                    <td className="ir-num">{sn(s.totalEstimate) > 0 ? fmtMoney(s.totalEstimate) : '—'}</td>
                    <td className="ir-num" style={{ color: '#16a34a' }}>{sn(s.totalSettled) > 0 ? fmtMoney(s.totalSettled) : '—'}</td>
                    <td className="ir-num">
                      <span className="ir-recoup-pct-pill" style={{
                        color: rp === 100 ? '#15803d' : rp >= 50 ? '#d97706' : '#dc2626',
                        background: rp === 100 ? '#dcfce7' : rp >= 50 ? '#fffbeb' : '#fef2f2',
                      }}>{rp}%</span>
                    </td>
                    <td className="ir-num" style={{ color: '#2563eb', fontWeight: 700 }}>
                      {sn(s.companyRecoup) > 0 ? fmtMoney(s.companyRecoup) : '—'}
                    </td>
                    <td className="ir-num">
                      {rate > 0 ? (
                        <span className="ir-rate-pill" style={{
                          color: rate >= 90 ? '#15803d' : rate >= 75 ? '#92400e' : '#991b1b',
                          background: rate >= 90 ? '#dcfce7' : rate >= 75 ? '#fef9c3' : '#fee2e2',
                        }}>{rate.toFixed(1)}%</span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Cash job KPIs ── */}
      <div className="ir-stream-label">💼 Cash Job Detail</div>
      <div className="ir-kpi-row">
        <KPICard label="Total Billed"    value={fmtMoney(totalBilled)}    sub={`${filtered.length} invoice${filtered.length !== 1 ? 's' : ''}`} color="#2563eb" />
        <KPICard label="Total Collected" value={fmtMoney(totalCollected)}  sub={`${filtered.filter(i => i.status === 'paid').length} paid`}         color="#16a34a" />
        <KPICard label="Outstanding"     value={fmtMoney(outstanding)}
          sub={outstanding > 0 ? 'balance remaining' : 'fully collected'}
          color={outstanding > 0 ? '#d97706' : '#16a34a'} />
        <KPICard label="Collection Rate" value={`${collectionRate.toFixed(1)}%`}
          sub={collectionRate >= 85 ? 'Excellent' : collectionRate >= 70 ? 'Good' : 'Needs attention'}
          color={collectionRate >= 85 ? '#16a34a' : collectionRate >= 70 ? '#d97706' : '#dc2626'} />
      </div>

      {/* ── Pipeline status ── */}
      <div className="ir-pipeline">
        <PipelinePill icon="🔴" label="Overdue"         count={overdueList.length}  amount={overdueList.reduce((s, i) => s + ((i.total||0) - (i.paidAmount||0)), 0)}  color="#dc2626" bg="#fef2f2" />
        <PipelinePill icon="🟡" label="Awaiting Payment" count={awaitingList.length} amount={awaitingList.reduce((s, i) => s + ((i.total||0) - (i.paidAmount||0)), 0)} color="#d97706" bg="#fffbeb" />
        <PipelinePill icon="📝" label="Drafts"           count={draftList.length}    amount={draftList.reduce((s, i) => s + (i.total||0), 0)}                           color="#64748b" bg="#f1f5f9" />
        <PipelinePill icon="📋" label="Open Estimates"   count={openEstimates.length} amount={openEstimates.reduce((s, i) => s + (i.total||0), 0)}                     color="#7c3aed" bg="#f5f3ff" />
      </div>

      {/* ── Monthly revenue chart (full-year only) ── */}
      {!selectedQ && totalBilled > 0 && (
        <div className="ir-section">
          <div className="ir-section-title">Monthly Revenue — {selectedYear}</div>
          <div className="ir-chart">
            <div className="ir-chart-legend">
              <span className="ir-legend-dot" style={{ background: '#bfdbfe' }} />Billed
              <span className="ir-legend-dot" style={{ background: '#2563eb', marginLeft: 16 }} />Collected
            </div>
            <div className="ir-chart-bars">
              {monthlyData.map((m, i) => (
                <div key={i} className="ir-chart-col">
                  <div className="ir-bar-group">
                    <div className="ir-bar ir-bar--billed"    style={{ height: `${Math.round((m.billed    / maxMonthly) * 100)}%` }} title={fmtMoney(m.billed)} />
                    <div className="ir-bar ir-bar--collected" style={{ height: `${Math.round((m.collected / maxMonthly) * 100)}%` }} title={fmtMoney(m.collected)} />
                  </div>
                  {m.billed > 0 && <div className="ir-bar-amt">{fmtMoney(m.billed, true)}</div>}
                  <div className="ir-chart-month">{MONTHS[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Quarterly summary ── */}
      {!selectedQ && (
        <div className="ir-section">
          <div className="ir-section-title">Quarterly Summary — {selectedYear}</div>
          <table className="ir-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th className="ir-num">Invoices</th>
                <th className="ir-num">Billed</th>
                <th className="ir-num">Collected</th>
                <th className="ir-num">Outstanding</th>
                <th className="ir-num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {quarterlyData.map(q => (
                <tr key={q.q} className={`ir-qrow${selectedQ === q.q ? ' ir-qrow--active' : ''}`}
                  onClick={() => setSelectedQ(q.q === selectedQ ? null : q.q)}
                  style={{ cursor: 'pointer' }}>
                  <td><span className="ir-q-label">Q{q.q}</span></td>
                  <td className="ir-num">{q.count || '—'}</td>
                  <td className="ir-num">{q.billed ? fmtMoney(q.billed) : '—'}</td>
                  <td className="ir-num">{q.collected ? fmtMoney(q.collected) : '—'}</td>
                  <td className="ir-num" style={{ color: q.outstanding > 0 ? '#d97706' : '#94a3b8' }}>
                    {q.outstanding > 0 ? fmtMoney(q.outstanding) : '—'}
                  </td>
                  <td className="ir-num">
                    {q.billed > 0 ? (
                      <span className="ir-rate-pill" style={{
                        color: q.rate >= 85 ? '#15803d' : q.rate >= 70 ? '#92400e' : '#991b1b',
                        background: q.rate >= 85 ? '#dcfce7' : q.rate >= 70 ? '#fef9c3' : '#fee2e2',
                      }}>{q.rate.toFixed(0)}%</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Aging report ── */}
      <div className="ir-section">
        <div className="ir-section-title">Outstanding Aging Report</div>
        {agingRows.every(r => !aging[r.key].length) ? (
          <div className="ir-empty-section">✅ No outstanding invoices — fully collected.</div>
        ) : (
          <div className="ir-aging">
            {agingRows.map(({ key, label, color }) => {
              const invs = aging[key]
              const amt  = invs.reduce((s, i) => s + ((i.total||0) - (i.paidAmount||0)), 0)
              const pct  = outstanding > 0 ? (amt / outstanding * 100) : 0
              return (
                <div key={key} className="ir-aging-row">
                  <div className="ir-aging-label" style={{ color }}>{label}</div>
                  <div className="ir-aging-bar-wrap">
                    <div className="ir-aging-bar" style={{ width: `${pct}%`, background: color, opacity: 0.7 }} />
                  </div>
                  <div className="ir-aging-count">{invs.length}</div>
                  <div className="ir-aging-amt" style={{ color: invs.length ? color : '#94a3b8' }}>
                    {invs.length ? fmtMoney(amt) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Per-client breakdown ── */}
      <div className="ir-section">
        <div className="ir-section-title-row">
          <div className="ir-section-title">Client Billing Report</div>
          <div className="ir-section-sub">{clientRows.length} client{clientRows.length !== 1 ? 's' : ''}</div>
        </div>
        {clientRows.length === 0 ? (
          <div className="ir-empty-section">No client data yet.</div>
        ) : (
          <table className="ir-table ir-table--clients">
            <thead>
              <tr>
                <th>Client</th>
                <th className="ir-num"># Invoices</th>
                <th className="ir-num">Billed</th>
                <th className="ir-num">Collected</th>
                <th className="ir-num">Outstanding</th>
                <th className="ir-num">Avg Days</th>
                <th className="ir-num">Status</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.map((c, idx) => {
                const st = STATUS_DISPLAY[c.status] || STATUS_DISPLAY.draft
                return (
                  <tr key={idx} className="ir-client-row"
                    onClick={() => c.phone && navigate(`/myclaim/clients/${encodeURIComponent(c.phone)}/invoices`)}
                    style={{ cursor: c.phone ? 'pointer' : 'default' }}>
                    <td>
                      <div className="ir-client-name">{c.name || '—'}</div>
                      {c.phone && <div className="ir-client-phone">{c.phone}</div>}
                    </td>
                    <td className="ir-num">{c.count}</td>
                    <td className="ir-num ir-bold">{fmtMoney(c.billed)}</td>
                    <td className="ir-num" style={{ color: '#16a34a' }}>{fmtMoney(c.collected)}</td>
                    <td className="ir-num">
                      <span style={{ color: c.outstanding > 0 ? '#d97706' : '#94a3b8', fontWeight: c.outstanding > 0 ? 700 : 400 }}>
                        {c.outstanding > 0 ? fmtMoney(c.outstanding) : '—'}
                      </span>
                    </td>
                    <td className="ir-num" style={{ color: '#64748b' }}>
                      {c.avgDays !== null ? `${c.avgDays}d` : '—'}
                    </td>
                    <td className="ir-num">
                      <span className="ir-status-pill" style={{ color: st.color, background: st.bg }}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="ir-total-row">
                <td><strong>Totals</strong></td>
                <td className="ir-num">{allInvoices.length}</td>
                <td className="ir-num ir-bold">{fmtMoney(clientRows.reduce((s, c) => s + c.billed, 0))}</td>
                <td className="ir-num" style={{ color: '#16a34a' }}>{fmtMoney(clientRows.reduce((s, c) => s + c.collected, 0))}</td>
                <td className="ir-num" style={{ color: '#d97706', fontWeight: 700 }}>{fmtMoney(clientRows.reduce((s, c) => s + c.outstanding, 0))}</td>
                <td className="ir-num">{avgDaysPay !== null ? `${avgDaysPay}d avg` : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Estimate funnel ── */}
      {estTotal > 0 && (
        <div className="ir-section">
          <div className="ir-section-title">Estimate Conversion Funnel</div>
          <div className="ir-funnel">
            <FunnelStep label="Estimates Created" value={estTotal}               pct={100}      color="#7c3aed" />
            <FunnelStep label="Sent to Client"    value={allEstimates.filter(e => e.status !== 'draft').length}
              pct={estTotal > 0 ? allEstimates.filter(e => e.status !== 'draft').length / estTotal * 100 : 0} color="#2563eb" />
            <FunnelStep label="Converted to Invoice" value={estConverted}        pct={estTotal > 0 ? estConverted / estTotal * 100 : 0} color="#16a34a" />
          </div>
        </div>
      )}

      {/* ── Insights ── */}
      {insights.length > 0 && (
        <div className="ir-section">
          <div className="ir-section-title">Key Insights</div>
          <div className="ir-insights">
            {insights.map((ins, i) => (
              <div key={i} className="ir-insight" style={{ borderLeftColor: ins.color, background: ins.bg }}>
                <span className="ir-insight-icon">{ins.icon}</span>
                <span className="ir-insight-text" style={{ color: ins.color }}>{ins.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Print-only header ── */}
      <div className="print-only ir-print-header">
        <strong>{orgName}</strong> — Invoice Report {selectedYear}{selectedQ ? ` Q${selectedQ}` : ''}
        <br />Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color }) {
  return (
    <div className="ir-kpi">
      <div className="ir-kpi-label">{label}</div>
      <div className="ir-kpi-value" style={{ color }}>{value}</div>
      <div className="ir-kpi-sub">{sub}</div>
    </div>
  )
}

function PipelinePill({ icon, label, count, amount, color, bg }) {
  return (
    <div className="ir-pill" style={{ background: bg }}>
      <span className="ir-pill-icon">{icon}</span>
      <div>
        <div className="ir-pill-count" style={{ color }}>{count}</div>
        <div className="ir-pill-label">{label}</div>
        {amount > 0 && <div className="ir-pill-amt" style={{ color }}>{
          amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        }</div>}
      </div>
    </div>
  )
}

function FunnelStep({ label, value, pct, color }) {
  return (
    <div className="ir-funnel-step">
      <div className="ir-funnel-bar-wrap">
        <div className="ir-funnel-bar" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="ir-funnel-labels">
        <span className="ir-funnel-label">{label}</span>
        <span className="ir-funnel-value" style={{ color }}>{value} ({Math.round(pct)}%)</span>
      </div>
    </div>
  )
}

const STATUS_DISPLAY = {
  paid:     { label: 'Paid',      icon: '✅', color: '#15803d', bg: '#dcfce7' },
  partial:  { label: 'Partial',   icon: '⚠️', color: '#92400e', bg: '#fef9c3' },
  overdue:  { label: 'Overdue',   icon: '🔴', color: '#991b1b', bg: '#fee2e2' },
  awaiting: { label: 'Awaiting',  icon: '📤', color: '#1e40af', bg: '#dbeafe' },
  draft:    { label: 'Draft',     icon: '📝', color: '#475569', bg: '#f1f5f9' },
  none:     { label: 'None',      icon: '—',  color: '#94a3b8', bg: '#f8fafc' },
}

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { useAuth } from './useAuth'
import './InvoiceReport.css'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const QUARTERS = { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' }
const SETT_STATUS = [
  { key: 'estimating',    label: 'Estimating',    color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'submitted',     label: 'Submitted',     color: '#2563eb', bg: '#eff6ff' },
  { key: 'negotiating',   label: 'Negotiating',   color: '#d97706', bg: '#fffbeb' },
  { key: 'supplementing', label: 'Supplementing', color: '#ea580c', bg: '#fff7ed' },
  { key: 'settled',       label: 'Settled',       color: '#16a34a', bg: '#dcfce7' },
]

function fmtMoney(n, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getYear(inv)    { return inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').getFullYear() : null }
function getMonth(inv)   { return inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').getMonth()    : null }
function getQuarter(inv) { const m = getMonth(inv); return m === null ? null : Math.floor(m / 3) + 1 }
function settYear(s)     { return s.settlementDate ? new Date(s.settlementDate + 'T12:00:00').getFullYear() : null }
function settQ(s)        { if (!s.settlementDate) return null; const m = new Date(s.settlementDate + 'T12:00:00').getMonth(); return Math.floor(m / 3) + 1 }

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

export default function InvoiceReport() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [summaries,       setSummaries]       = useState([])
  const [settlements,     setSettlements]     = useState([])
  const [partners,        setPartners]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [orgName,         setOrgName]         = useState('')
  const [selectedYear,    setSelectedYear]    = useState(new Date().getFullYear())
  const [selectedQ,       setSelectedQ]       = useState(null)
  const [paidInvOpen,     setPaidInvOpen]     = useState(false)
  const [insurerSearch,   setInsurerSearch]   = useState('')
  const [claimSearch,     setClaimSearch]     = useState('')
  const [fullView,        setFullView]        = useState(null) // null | 'insurers' | 'claims'

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return

      const orgSnap = await getDoc(doc(db, 'organization_data', oid))
      if (orgSnap.exists()) setOrgName(orgSnap.data().companyName || '')

      const [invSnap, settSnap, partnerSnap] = await Promise.all([
        getDocs(collection(db, 'organization_data', oid, 'invoice_summary')),
        getDocs(collection(db, 'organization_data', oid, 'settlement_summary')),
        getDocs(collection(db, 'organization_data', oid, 'partners')).catch(() => ({ docs: [] })),
      ])
      setSummaries(invSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setSettlements(settSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

const sn = v => parseFloat(v) || 0

  // ── Available years: invoices + settlements ──
  const availableYears = useMemo(() => {
    const years = new Set()
    summaries.forEach(s => { const y = getYear(s); if (y) years.add(y) })
    settlements.forEach(s => { const y = settYear(s); if (y) years.add(y) })
    const cur = new Date().getFullYear()
    years.add(cur); years.add(cur - 1)
    return Array.from(years).sort((a, b) => b - a)
  }, [summaries, settlements])

  // ── Filtered invoices ──
  const filtered = useMemo(() => summaries.filter(s => {
    if (s.type !== 'invoice') return false
    if (getYear(s) !== selectedYear) return false
    if (selectedQ && getQuarter(s) !== selectedQ) return false
    return true
  }), [summaries, selectedYear, selectedQ])

  // ── Paid invoices (year + Q filtered) ──
  const paidInvoiceList = useMemo(() => summaries
    .filter(s => s.type === 'invoice' && s.status === 'paid' && getYear(s) === selectedYear && (!selectedQ || getQuarter(s) === selectedQ))
    .sort((a, b) => (a.paidDate || a.issueDate || '') > (b.paidDate || b.issueDate || '') ? -1 : 1)
  , [summaries, selectedYear, selectedQ])

  const paidInvoiceTotal = paidInvoiceList.reduce((s, i) => s + (i.total || 0), 0)

  // ── Estimates: year-filtered for funnel, lifetime for conversion rate ──
  const allEstimates         = useMemo(() => summaries.filter(s => s.type === 'estimate' && getYear(s) === selectedYear), [summaries, selectedYear])
  const allEstimatesLifetime = useMemo(() => summaries.filter(s => s.type === 'estimate'), [summaries])

  // ── KPIs ──
  const totalBilled    = filtered.reduce((s, i) => s + (i.total || 0), 0)
  const totalCollected = filtered.reduce((s, i) => s + (i.paidAmount || 0), 0)
  const outstanding    = totalBilled - totalCollected
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled * 100) : 0

  // ── All-time invoices for overdue/pipeline alerts ──
  const allInvoices   = summaries.filter(s => s.type === 'invoice')
  const overdueList   = allInvoices.filter(i => isOverdue(i))
  const awaitingList  = allInvoices.filter(i => !isOverdue(i) && i.status === 'sent')
  const draftList     = allInvoices.filter(i => i.status === 'draft')
  const openEstimates = allEstimatesLifetime.filter(i => i.status === 'draft' || i.status === 'sent')

  // ── Filtered settlements: undated only in full-year view ──
  const filteredSettlements = useMemo(() => settlements.filter(s => {
    if (!s.settlementDate) return !selectedQ
    const d = new Date(s.settlementDate + 'T12:00:00')
    if (d.getFullYear() !== selectedYear) return false
    if (selectedQ && Math.floor(d.getMonth() / 3) + 1 !== selectedQ) return false
    return true
  }), [settlements, selectedYear, selectedQ])

  // ── Settlement KPI buckets ──
  const settledClaims      = filteredSettlements.filter(s => sn(s.totalSettled) > 0)
  const pendingClaims      = filteredSettlements.filter(s => !sn(s.totalSettled))
  const settTotalSubmitted = settledClaims.reduce((s, x) => s + sn(x.totalEstimate), 0)
  const settTotalSettled   = settledClaims.reduce((s, x) => s + sn(x.totalSettled),  0)
  const settTotalGap          = settledClaims.reduce((s, x) => s + sn(x.gap),           0)
  const settTotalRecoup       = settledClaims.reduce((s, x) => s + sn(x.companyRecoup), 0)
  const settTotalPartnerFees  = settledClaims.reduce((s, x) => s + sn(x.partnerFee),    0)
  const settAvgRecovery       = settTotalSubmitted > 0 ? settTotalSettled / settTotalSubmitted * 100 : 0

  // ── Status pipeline (all-time, not year/Q filtered) ──
  const statusPipeline = useMemo(() => {
    const counts = {}
    SETT_STATUS.forEach(s => { counts[s.key] = { count: 0, exposure: 0 } })
    settlements.forEach(s => {
      const key = s.status || 'estimating'
      if (counts[key]) {
        counts[key].count++
        counts[key].exposure += sn(s.totalEstimate)
      }
    })
    return SETT_STATUS.map(s => ({ ...s, ...counts[s.key] }))
  }, [settlements])

  // ── Insurer breakdown (settled claims only) ──
  const insurerData = useMemo(() => {
    const map = {}
    settledClaims.forEach(s => {
      const key = s.insuranceCompany || 'Unknown'
      if (!map[key]) map[key] = { name: key, claims: 0, submitted: 0, settled: 0, recoup: 0 }
      map[key].claims++
      map[key].submitted += sn(s.totalEstimate)
      map[key].settled   += sn(s.totalSettled)
      map[key].recoup    += sn(s.companyRecoup)
    })
    return Object.values(map).sort((a, b) => b.settled - a.settled)
  }, [settledClaims])

  // ── Monthly data with recoup ──
  const monthlyData = useMemo(() => {
    if (selectedQ) return []
    return MONTHS.map((_, m) => {
      const invs  = filtered.filter(i => getMonth(i) === m)
      const setts = filteredSettlements.filter(s => {
        if (!s.settlementDate) return false
        return new Date(s.settlementDate + 'T12:00:00').getMonth() === m && sn(s.totalSettled) > 0
      })
      return {
        billed:    invs.reduce((s, i) => s + (i.total || 0), 0),
        collected: invs.reduce((s, i) => s + (i.paidAmount || 0), 0),
        recoup:    setts.reduce((s, x) => s + sn(x.companyRecoup), 0),
        count:     invs.length,
      }
    })
  }, [filtered, filteredSettlements, selectedQ])

  const maxMonthly = Math.max(...monthlyData.map(m => m.billed + m.recoup), 1)

  // ── Quarterly summary with insurance columns ──
  const quarterlyData = useMemo(() => [1, 2, 3, 4].map(q => {
    const qInvs  = summaries.filter(s => s.type === 'invoice' && getYear(s) === selectedYear && getQuarter(s) === q)
    const qSetts = settlements.filter(s => s.settlementDate && settYear(s) === selectedYear && settQ(s) === q)
    const billed    = qInvs.reduce((s, i) => s + (i.total || 0), 0)
    const collected = qInvs.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const recoup    = qSetts.filter(s => sn(s.totalSettled) > 0).reduce((s, x) => s + sn(x.companyRecoup), 0)
    return {
      q, count: qInvs.length, billed, collected,
      outstanding: billed - collected,
      rate: billed > 0 ? collected / billed * 100 : 0,
      claims: qSetts.filter(s => sn(s.totalSettled) > 0).length, recoup,
      totalRevenue: collected + recoup,
    }
  }), [summaries, settlements, selectedYear])

  // ── Q card grid data ──
  const qCardData = useMemo(() => {
    const perQ = [1, 2, 3, 4].map(q => {
      const d = quarterlyData.find(x => x.q === q)
      return { q, label: `Q${q}`, range: QUARTERS[q], ...(d || { count: 0, billed: 0, collected: 0, recoup: 0, totalRevenue: 0, claims: 0 }) }
    })
    const fyInvs    = summaries.filter(s => s.type === 'invoice' && getYear(s) === selectedYear)
    const fySettsAll    = settlements.filter(s => !s.settlementDate || settYear(s) === selectedYear)
    const fySettsSettled = fySettsAll.filter(s => sn(s.totalSettled) > 0)
    const fyBilled    = fyInvs.reduce((s, i) => s + (i.total || 0), 0)
    const fyCollected = fyInvs.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const fyRecoup    = fySettsSettled.reduce((s, x) => s + sn(x.companyRecoup), 0)
    const fyCard = {
      q: null, label: 'Full Year', range: String(selectedYear),
      billed: fyBilled, collected: fyCollected, recoup: fyRecoup,
      totalRevenue: fyCollected + fyRecoup,
      count: fyInvs.length, claims: fySettsSettled.length,
    }
    return [fyCard, ...perQ]
  }, [quarterlyData, summaries, settlements, selectedYear])

  // ── Aging ──
  const aging = useMemo(() => {
    const groups = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] }
    allInvoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .forEach(i => groups[ageGroup(i)].push(i))
    return groups
  }, [allInvoices])

  const agingRows = [
    { key: 'current', label: 'Current (not yet due)',  color: '#16a34a' },
    { key: '1-30',    label: '1–30 days overdue',       color: '#d97706' },
    { key: '31-60',   label: '31–60 days overdue',      color: '#ea580c' },
    { key: '61-90',   label: '61–90 days overdue',      color: '#dc2626' },
    { key: '90+',     label: '90+ days overdue',        color: '#7f1d1d' },
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
      return { ...c, billed, collected, outstanding: billed - collected, avgDays, status: clientStatus(c.invoices), count: c.invoices.length }
    }).sort((a, b) => b.outstanding - a.outstanding)
  }, [allInvoices])

  // ── Estimate conversion (lifetime) ──
  const estTotal     = allEstimatesLifetime.length
  const estConverted = allEstimatesLifetime.filter(e => e.status === 'converted').length
  const estRate      = estTotal > 0 ? Math.round(estConverted / estTotal * 100) : 0

  // ── Avg days to payment ──
  const paidWithDates = allInvoices.filter(i => i.status === 'paid' && i.issueDate && i.paidAt?.toDate)
  const avgDaysPay = paidWithDates.length
    ? Math.round(paidWithDates.reduce((s, i) => s + (i.paidAt.toDate() - new Date(i.issueDate + 'T12:00:00')) / 86400000, 0) / paidWithDates.length)
    : null

  // ── Settlement category data (settled claims only) ──
  const settCatData = [
    {
      label: 'Dry Cleaning / Contents',
      submitted: settledClaims.reduce((s, x) => s + sn(x.dryCleanEstimate), 0),
      settled:   settledClaims.reduce((s, x) => s + sn(x.dryCleanSettled),  0),
    },
    {
      label: 'Mitigation',
      submitted: settledClaims.reduce((s, x) => s + sn(x.mitigationEstimate), 0),
      settled:   settledClaims.reduce((s, x) => s + sn(x.mitigationSettled),  0),
    },
    {
      label: 'Reconstruction',
      submitted: settledClaims.reduce((s, x) => s + sn(x.reconstructionEstimate), 0),
      settled:   settledClaims.reduce((s, x) => s + sn(x.reconstructionSettled),  0),
    },
  ]

  const recoupBuckets = [
    { label: 'Full Recoup (100%)',    color: '#15803d', bg: '#dcfce7', items: settledClaims.filter(s => sn(s.recoupPercent) === 100) },
    { label: 'Shared (50–99%)',       color: '#d97706', bg: '#fffbeb', items: settledClaims.filter(s => { const r = sn(s.recoupPercent); return r >= 50 && r < 100 }) },
    { label: 'Minority Split (<50%)', color: '#dc2626', bg: '#fef2f2', items: settledClaims.filter(s => sn(s.recoupPercent) < 50 && sn(s.recoupPercent) > 0) },
  ]

  // ── Partner stats (settled claims only — no final settlement means no fee is earned yet) ──
  const partnerStats = useMemo(() => {
    const map = {}
    settlements.filter(s => sn(s.totalSettled) > 0).forEach(s => {
      if (!s.partnerId) return
      const key = s.partnerId
      if (!map[key]) map[key] = { id: key, name: s.partnerName || 'Unknown', claims: 0, submitted: 0, settled: 0, companyRecoup: 0, partnerFee: 0 }
      map[key].claims++
      map[key].submitted     += sn(s.totalEstimate)
      map[key].settled       += sn(s.totalSettled)
      map[key].companyRecoup += sn(s.companyRecoup)
      map[key].partnerFee    += sn(s.partnerFee)
    })
    return Object.values(map).sort((a, b) => b.submitted - a.submitted)
  }, [settlements])

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

    if (settAvgRecovery > 0 && settAvgRecovery < 75) {
      list.push({ icon: '📉', color: '#dc2626', bg: '#fef2f2', text: `Insurance recovery rate is ${settAvgRecovery.toFixed(1)}% — below 75%, review negotiation strategy.` })
    } else if (settAvgRecovery >= 90) {
      list.push({ icon: '🏛️', color: '#15803d', bg: '#dcfce7', text: `Insurance recovery rate is ${settAvgRecovery.toFixed(1)}% — strong negotiation outcomes.` })
    }
    if (pendingClaims.length > 0) {
      const exposure = pendingClaims.reduce((s, x) => s + sn(x.totalEstimate), 0)
      list.push({ icon: '⏳', color: '#7c3aed', bg: '#f5f3ff', text: `${pendingClaims.length} insurance claim${pendingClaims.length !== 1 ? 's' : ''} pending settlement — ${fmtMoney(exposure)} estimated exposure.` })
    }
    if (settTotalGap > 0) {
      list.push({ icon: '📋', color: '#d97706', bg: '#fffbeb', text: `${fmtMoney(settTotalGap)} written off across settled claims — review supplement opportunities.` })
    }
    if (insurerData.length > 1) {
      const best = [...insurerData].filter(x => x.settled > 0).sort((a, b) => (b.settled / b.submitted) - (a.settled / a.submitted))[0]
      if (best) {
        const rate = best.submitted > 0 ? (best.settled / best.submitted * 100).toFixed(1) : '0'
        list.push({ icon: '🏆', color: '#2563eb', bg: '#eff6ff', text: `Best recovery from ${best.name}: ${rate}% on ${fmtMoney(best.submitted)} submitted.` })
      }
    }
    const bestQ = [...quarterlyData].sort((a, b) => b.totalRevenue - a.totalRevenue)[0]
    if (bestQ?.totalRevenue > 0) list.push({ icon: '📈', color: '#2563eb', bg: '#eff6ff', text: `Best quarter: Q${bestQ.q} with ${fmtMoney(bestQ.totalRevenue)} combined revenue.` })

    const topClient = clientRows[0]
    if (topClient?.outstanding > 0) list.push({ icon: '👤', color: '#7c3aed', bg: '#f5f3ff', text: `Top outstanding client: ${topClient.name} (${fmtMoney(topClient.outstanding)} owed of ${fmtMoney(topClient.billed)} billed).` })
    if (estTotal > 0) list.push({ icon: '📋', color: '#0891b2', bg: '#ecfeff', text: `Estimate conversion rate: ${estRate}% (${estConverted} of ${estTotal} estimates became invoices).` })
    if (avgDaysPay !== null) list.push({ icon: '⏱', color: '#475569', bg: '#f8fafc', text: `Average days to payment: ${avgDaysPay} days.` })
    if (partnerStats.length > 0) {
      const top = partnerStats[0]
      list.push({ icon: '🤝', color: '#0891b2', bg: '#ecfeff', text: `Top referral partner: ${top.name} — brought in ${top.claims} claim${top.claims !== 1 ? 's' : ''} worth ${fmtMoney(top.submitted)} submitted.` })
    }
    return list
  }, [overdueList, collectionRate, quarterlyData, clientRows, estTotal, estConverted, estRate, avgDaysPay, settAvgRecovery, pendingClaims, settTotalGap, insurerData, partnerStats])

  // ── Render ──

  if (loading) return <div className="ir-loading">Loading report…</div>

  if (summaries.length === 0 && settlements.length === 0) {
    return (
      <div className="ir-root">
        <div className="ir-empty-state">
          <div className="ir-empty-icon">📊</div>
          <h2 className="ir-empty-title">No data yet</h2>
          <p className="ir-empty-sub">Create your first invoice, estimate, or insurance claim to start seeing reports.</p>
          <button className="ir-btn ir-btn--primary" onClick={() => navigate('/myclaim/clients')}>Go to Clients</button>
        </div>
      </div>
    )
  }

  const totalRevenue = totalCollected + settTotalRecoup
  const cashPct      = totalRevenue > 0 ? totalCollected  / totalRevenue * 100 : 0
  const insPct       = totalRevenue > 0 ? settTotalRecoup / totalRevenue * 100 : 0

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

      {/* ── Q card grid (replaces pill buttons) ── */}
      <div className="ir-qcard-grid no-print-hide">
        {qCardData.map(card => (
          <button
            key={String(card.q)}
            className={`ir-qcard${selectedQ === card.q ? ' ir-qcard--active' : ''}`}
            onClick={() => setSelectedQ(card.q)}
          >
            <div className="ir-qcard-label">{card.label}</div>
            <div className="ir-qcard-range">{card.range}</div>
            <div className="ir-qcard-revenue">{fmtMoney(card.totalRevenue || 0, true)}</div>
            <div className="ir-qcard-sub">
              {(card.count || 0) > 0 && `${card.count} job${card.count !== 1 ? 's' : ''}`}
              {(card.count || 0) > 0 && (card.claims || 0) > 0 && ' · '}
              {(card.claims || 0) > 0 && `${card.claims} claim${card.claims !== 1 ? 's' : ''}`}
              {!(card.count || 0) && !(card.claims || 0) && 'No activity'}
            </div>
          </button>
        ))}
      </div>

      {/* ── Combined company sales ── */}
      <div className="ir-combined-block">
        <div className="ir-combined-label">Total Company Sales — {selectedYear}{selectedQ ? ` Q${selectedQ}` : ''}</div>
        <div className="ir-combined-hero">{fmtMoney(totalRevenue)}</div>
        <div className="ir-combined-sub">
          {filtered.length} cash job{filtered.length !== 1 ? 's' : ''}
          {settledClaims.length > 0 && ` · ${settledClaims.length} insurance claim${settledClaims.length !== 1 ? 's' : ''}`}
        </div>
        {totalRevenue > 0 && (
          <>
            <div className="ir-split-bar">
              {totalCollected > 0 && <div className="ir-split-seg ir-split-seg--cash" style={{ flex: totalCollected }} title={`Cash: ${fmtMoney(totalCollected)}`} />}
              {settTotalRecoup > 0 && <div className="ir-split-seg ir-split-seg--ins"  style={{ flex: settTotalRecoup }} title={`Insurance recoup: ${fmtMoney(settTotalRecoup)}`} />}
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

      {/* ── Paid Invoices ── */}
      {paidInvoiceList.length > 0 && (
        <div className="ir-section ir-section--paid-inv">
          <div
            className="ir-section-title-row"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setPaidInvOpen(o => !o)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="ir-section-title" style={{ color: '#16a34a' }}>✓ Paid Invoices</div>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: '#f0fdf4', color: '#16a34a' }}>
                {paidInvoiceList.length}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="ir-section-sub" style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(paidInvoiceTotal)} collected</div>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{paidInvOpen ? '▲' : '▼'}</span>
            </div>
          </div>
          {paidInvOpen && (
            <table className="ir-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Invoice #</th>
                  <th className="ir-num">Amount</th>
                  <th>Date Paid</th>
                </tr>
              </thead>
              <tbody>
                {paidInvoiceList.map(r => (
                  <tr key={r.id}
                    style={{ cursor: r.clientPhone ? 'pointer' : 'default' }}
                    onClick={() => r.clientPhone && navigate(`/myclaim/clients/${encodeURIComponent(r.clientPhone)}/invoices/${r.invoiceId || r.id}`)}
                  >
                    <td style={{ fontWeight: 600 }}>{r.clientName || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{r.invoiceNumber || '—'}</td>
                    <td className="ir-num" style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                    <td style={{ color: '#64748b' }}>{fmtDate(r.paidDate || r.issueDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ir-total-row">
                  <td colSpan={2}><strong>Total</strong></td>
                  <td className="ir-num" style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(paidInvoiceTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Pending claims banner ── */}
      {pendingClaims.length > 0 && (
        <div className="ir-pending-banner">
          <span className="ir-pending-icon">⏳</span>
          <div>
            <div className="ir-pending-title">
              {pendingClaims.length} claim{pendingClaims.length !== 1 ? 's' : ''} pending final settlement
            </div>
            <div className="ir-pending-sub">
              Estimated exposure: {fmtMoney(pendingClaims.reduce((s, x) => s + sn(x.totalEstimate), 0))}
              {pendingClaims.some(c => c.clientName) && ` — ${pendingClaims.map(c => c.clientName).filter(Boolean).slice(0, 3).join(', ')}${pendingClaims.length > 3 ? ` +${pendingClaims.length - 3} more` : ''}`}
            </div>
          </div>
        </div>
      )}

      {/* ── Insurance settlement performance ── */}
      {filteredSettlements.length > 0 && (
        <div className="ir-section ir-section--settlement">
          <div className="ir-stream-label">🏛️ Insurance Job Detail</div>
          <div className="ir-section-title-row">
            <div className="ir-section-title">Settlement Performance</div>
            <div className="ir-section-sub">{settledClaims.length} settled claim{settledClaims.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="ir-kpi-row ir-kpi-row--5">
            <KPICard label="Total Submitted"   value={fmtMoney(settTotalSubmitted)} sub="to insurance"                                   color="#0f172a" />
            <KPICard label="Total Settled"     value={fmtMoney(settTotalSettled)}   sub={`${settAvgRecovery.toFixed(1)}% recovery`}       color="#16a34a" />
            <KPICard label="Written Off"       value={fmtMoney(settTotalGap)}       sub="uncollected gap"                                 color={settTotalGap > 0 ? '#dc2626' : '#94a3b8'} />
            <KPICard label="Referral Fees Paid" value={fmtMoney(settTotalPartnerFees)}                    sub="paid to partners"    color="#7c3aed" />
            <KPICard label="Company Net"       value={fmtMoney(Math.max(0, settTotalSettled - settTotalPartnerFees))} sub="after referral fees" color="#2563eb" />
          </div>

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
                  const gap  = Math.max(0, cat.submitted - cat.settled)
                  const rate = cat.submitted > 0 ? cat.settled / cat.submitted * 100 : 0
                  return (
                    <tr key={cat.label}>
                      <td>{cat.label}</td>
                      <td className="ir-num">{cat.submitted > 0 ? fmtMoney(cat.submitted) : '—'}</td>
                      <td className="ir-num" style={{ color: '#16a34a' }}>{cat.settled > 0 ? fmtMoney(cat.settled) : '—'}</td>
                      <td className="ir-num" style={{ color: gap > 0 ? '#dc2626' : '#94a3b8' }}>{gap > 0 ? `– ${fmtMoney(gap)}` : '—'}</td>
                      <td className="ir-num">
                        {cat.submitted > 0
                          ? <span className="ir-rate-pill" style={{ color: rate >= 90 ? '#15803d' : rate >= 75 ? '#92400e' : '#991b1b', background: rate >= 90 ? '#dcfce7' : rate >= 75 ? '#fef9c3' : '#fee2e2' }}>{rate.toFixed(1)}%</span>
                          : '—'}
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
                  <td className="ir-num" style={{ color: settTotalGap > 0 ? '#dc2626' : '#94a3b8', fontWeight: 700 }}>{settTotalGap > 0 ? `– ${fmtMoney(settTotalGap)}` : '—'}</td>
                  <td className="ir-num">
                    <span className="ir-rate-pill" style={{ color: settAvgRecovery >= 90 ? '#15803d' : settAvgRecovery >= 75 ? '#92400e' : '#991b1b', background: settAvgRecovery >= 90 ? '#dcfce7' : settAvgRecovery >= 75 ? '#fef9c3' : '#fee2e2' }}>{settAvgRecovery.toFixed(1)}%</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* Insurer breakdown */}
          {insurerData.length > 0 && (() => {
            const q = insurerSearch.toLowerCase()
            const filtered = insurerData.filter(ins => !q || ins.name.toLowerCase().includes(q))
            const visible  = filtered.slice(0, 3)
            return (
              <>
                <div className="ir-subsection-header" style={{ marginTop: 20 }}>
                  <span className="ir-section-label-sm">Insurer Breakdown</span>
                  {insurerData.length > 3 && (
                    <button className="ir-viewall-btn" onClick={() => setFullView('insurers')}>
                      View All {insurerData.length} →
                    </button>
                  )}
                </div>
                <input
                  className="ir-search-input"
                  type="text"
                  placeholder="Search insurer…"
                  value={insurerSearch}
                  onChange={e => setInsurerSearch(e.target.value)}
                />
                <InsurerTable rows={visible} />
                {filtered.length > 3 && !insurerSearch && (
                  <p className="ir-preview-note">Showing top 3 of {filtered.length} — <button className="ir-link-btn" onClick={() => setFullView('insurers')}>view all</button></p>
                )}
                {insurerSearch && filtered.length === 0 && (
                  <p className="ir-preview-note">No insurers match "{insurerSearch}"</p>
                )}
              </>
            )
          })()}

          {/* Claim detail */}
          {(() => {
            const allClaims = [...filteredSettlements].sort((a, b) => sn(b.totalSettled) - sn(a.totalSettled))
            const q = claimSearch.toLowerCase()
            const filteredClaims = allClaims.filter(s =>
              !q ||
              (s.clientName || '').toLowerCase().includes(q) ||
              (s.claimNumber || '').toLowerCase().includes(q) ||
              (s.insuranceCompany || '').toLowerCase().includes(q)
            )
            const visible = filteredClaims.slice(0, 3)
            return (
              <>
                <div className="ir-subsection-header" style={{ marginTop: 18 }}>
                  <span className="ir-section-label-sm">Claim Detail</span>
                  {allClaims.length > 3 && (
                    <button className="ir-viewall-btn" onClick={() => setFullView('claims')}>
                      View All {allClaims.length} →
                    </button>
                  )}
                </div>
                <input
                  className="ir-search-input"
                  type="text"
                  placeholder="Search client, claim #, insurer…"
                  value={claimSearch}
                  onChange={e => setClaimSearch(e.target.value)}
                />
                <ClaimTable rows={visible} sn={sn} />
                {filteredClaims.length > 3 && !claimSearch && (
                  <p className="ir-preview-note">Showing top 3 of {filteredClaims.length} — <button className="ir-link-btn" onClick={() => setFullView('claims')}>view all</button></p>
                )}
                {claimSearch && filteredClaims.length === 0 && (
                  <p className="ir-preview-note">No claims match "{claimSearch}"</p>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ── Partner & Referral Performance ── */}
      {partnerStats.length > 0 && (
        <div className="ir-section">
          <div className="ir-section-title">Partner & Referral Performance</div>
          <table className="ir-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th className="ir-num">Jobs</th>
                <th className="ir-num">Total Submitted</th>
                <th className="ir-num">Total Settled</th>
                <th className="ir-num">Referral Fee Paid</th>
                <th className="ir-num">Net to Company</th>
              </tr>
            </thead>
            <tbody>
              {partnerStats.map(p => (
                <tr key={p.id} className="ir-partner-row" style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/myclaim/partners/${p.id}`)}>
                  <td style={{ fontWeight: 600 }}>👤 {p.name}</td>
                  <td className="ir-num">{p.claims}</td>
                  <td className="ir-num">{p.submitted > 0 ? fmtMoney(p.submitted) : '—'}</td>
                  <td className="ir-num" style={{ color: '#16a34a' }}>{p.settled > 0 ? fmtMoney(p.settled) : '—'}</td>
                  <td className="ir-num" style={{ color: '#dc2626' }}>{p.partnerFee > 0 ? fmtMoney(p.partnerFee) : '—'}</td>
                  <td className="ir-num ir-bold" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    {fmtMoney(Math.max(0, p.settled - p.partnerFee))}
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {partnerStats.length > 1 && (
              <tfoot>
                <tr className="ir-total-row">
                  <td><strong>Total</strong></td>
                  <td className="ir-num">{partnerStats.reduce((s, p) => s + p.claims, 0)}</td>
                  <td className="ir-num ir-bold">{fmtMoney(partnerStats.reduce((s, p) => s + p.submitted, 0))}</td>
                  <td className="ir-num" style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(partnerStats.reduce((s, p) => s + p.settled, 0))}</td>
                  <td className="ir-num" style={{ color: '#dc2626', fontWeight: 700 }}>{fmtMoney(partnerStats.reduce((s, p) => s + p.partnerFee, 0))}</td>
                  <td className="ir-num ir-bold">{fmtMoney(Math.max(0, partnerStats.reduce((s, p) => s + p.settled - p.partnerFee, 0)))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── Cash job KPIs ── */}
      <div className="ir-stream-label">💼 Cash Job Detail</div>
      <div className="ir-kpi-row">
        <KPICard label="Total Billed"    value={fmtMoney(totalBilled)}   sub={`${filtered.length} invoice${filtered.length !== 1 ? 's' : ''}`}           color="#2563eb" />
        <KPICard label="Total Collected" value={fmtMoney(totalCollected)} sub={`${filtered.filter(i => i.status === 'paid').length} paid`}                 color="#16a34a" />
        <KPICard label="Outstanding"     value={fmtMoney(outstanding)}    sub={outstanding > 0 ? 'balance remaining' : 'fully collected'}                  color={outstanding > 0 ? '#d97706' : '#16a34a'} />
        <KPICard label="Collection Rate" value={`${collectionRate.toFixed(1)}%`} sub={collectionRate >= 85 ? 'Excellent' : collectionRate >= 70 ? 'Good' : 'Needs attention'} color={collectionRate >= 85 ? '#16a34a' : collectionRate >= 70 ? '#d97706' : '#dc2626'} />
      </div>

      {/* ── Cash pipeline ── */}
      <div className="ir-pipeline">
        <PipelinePill icon="🔴" label="Overdue"          count={overdueList.length}   amount={overdueList.reduce((s, i) => s + ((i.total||0) - (i.paidAmount||0)), 0)}  color="#dc2626" bg="#fef2f2" />
        <PipelinePill icon="🟡" label="Awaiting Payment" count={awaitingList.length}  amount={awaitingList.reduce((s, i) => s + ((i.total||0) - (i.paidAmount||0)), 0)} color="#d97706" bg="#fffbeb" />
        <PipelinePill icon="📝" label="Drafts"           count={draftList.length}     amount={draftList.reduce((s, i) => s + (i.total||0), 0)}                           color="#64748b" bg="#f1f5f9" />
        <PipelinePill icon="📋" label="Open Estimates"  count={openEstimates.length} amount={openEstimates.reduce((s, i) => s + (i.total||0), 0)}                       color="#7c3aed" bg="#f5f3ff" />
      </div>

      {/* ── Monthly revenue chart with recoup ── */}
      {!selectedQ && (totalBilled > 0 || settTotalRecoup > 0) && (
        <div className="ir-section">
          <div className="ir-section-title">Monthly Revenue — {selectedYear}</div>
          <div className="ir-chart">
            <div className="ir-chart-legend">
              <span className="ir-legend-dot" style={{ background: '#bfdbfe' }} /> Billed
              <span className="ir-legend-dot" style={{ background: '#2563eb', marginLeft: 16 }} /> Collected
              <span className="ir-legend-dot" style={{ background: '#22c55e', marginLeft: 16 }} /> Ins. Recoup
            </div>
            <div className="ir-chart-bars">
              {monthlyData.map((m, i) => (
                <div key={i} className="ir-chart-col">
                  <div className="ir-bar-group">
                    <div className="ir-bar ir-bar--billed"    style={{ height: `${Math.round(((m.billed    || 0) / maxMonthly) * 100)}%` }} title={fmtMoney(m.billed)} />
                    <div className="ir-bar ir-bar--collected" style={{ height: `${Math.round(((m.collected || 0) / maxMonthly) * 100)}%` }} title={fmtMoney(m.collected)} />
                    {m.recoup > 0 && <div className="ir-bar ir-bar--recoup" style={{ height: `${Math.round((m.recoup / maxMonthly) * 100)}%` }} title={`Recoup: ${fmtMoney(m.recoup)}`} />}
                  </div>
                  {(m.billed > 0 || m.recoup > 0) && <div className="ir-bar-amt">{fmtMoney(m.billed + m.recoup, true)}</div>}
                  <div className="ir-chart-month">{MONTHS[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Quarterly summary with insurance ── */}
      {!selectedQ && (
        <div className="ir-section">
          <div className="ir-section-title">Quarterly Summary — {selectedYear}</div>
          <table className="ir-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th className="ir-num">Cash Jobs</th>
                <th className="ir-num">Billed</th>
                <th className="ir-num">Collected</th>
                <th className="ir-num">Claims</th>
                <th className="ir-num">Ins. Recoup</th>
                <th className="ir-num">Total Rev.</th>
                <th className="ir-num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {quarterlyData.map(q => (
                <tr key={q.q} className={`ir-qrow${selectedQ === q.q ? ' ir-qrow--active' : ''}`}
                  onClick={() => setSelectedQ(q.q === selectedQ ? null : q.q)}
                  style={{ cursor: 'pointer' }}>
                  <td>
                    <span className="ir-q-label">Q{q.q}</span>
                    <span className="ir-q-range">{QUARTERS[q.q]}</span>
                  </td>
                  <td className="ir-num">{q.count || '—'}</td>
                  <td className="ir-num">{q.billed ? fmtMoney(q.billed) : '—'}</td>
                  <td className="ir-num" style={{ color: '#16a34a' }}>{q.collected ? fmtMoney(q.collected) : '—'}</td>
                  <td className="ir-num">{q.claims || '—'}</td>
                  <td className="ir-num" style={{ color: '#22c55e', fontWeight: q.recoup > 0 ? 700 : 400 }}>{q.recoup > 0 ? fmtMoney(q.recoup) : '—'}</td>
                  <td className="ir-num ir-bold">{q.totalRevenue > 0 ? fmtMoney(q.totalRevenue) : '—'}</td>
                  <td className="ir-num">
                    {q.billed > 0
                      ? <span className="ir-rate-pill" style={{ color: q.rate >= 85 ? '#15803d' : q.rate >= 70 ? '#92400e' : '#991b1b', background: q.rate >= 85 ? '#dcfce7' : q.rate >= 70 ? '#fef9c3' : '#fee2e2' }}>{q.rate.toFixed(0)}%</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Aging ── */}
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
                  <div className="ir-aging-amt" style={{ color: invs.length ? color : '#94a3b8' }}>{invs.length ? fmtMoney(amt) : '—'}</div>
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
                    <td className="ir-num" style={{ color: '#64748b' }}>{c.avgDays !== null ? `${c.avgDays}d` : '—'}</td>
                    <td className="ir-num">
                      <span className="ir-status-pill" style={{ color: st.color, background: st.bg }}>{st.icon} {st.label}</span>
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

      {/* ── Estimate funnel (year-scoped) ── */}
      {allEstimatesLifetime.length > 0 && (
        <div className="ir-section">
          <div className="ir-section-title">Estimate Conversion Funnel — {selectedYear}</div>
          {allEstimates.length === 0 ? (
            <div className="ir-empty-section">No estimates created in {selectedYear}.</div>
          ) : (
            <div className="ir-funnel">
              <FunnelStep label="Estimates Created"    value={allEstimates.length} pct={100} color="#7c3aed" />
              <FunnelStep label="Sent to Client"
                value={allEstimates.filter(e => e.status !== 'draft').length}
                pct={allEstimates.filter(e => e.status !== 'draft').length / allEstimates.length * 100}
                color="#2563eb" />
              <FunnelStep label="Converted to Invoice"
                value={allEstimates.filter(e => e.status === 'converted').length}
                pct={allEstimates.filter(e => e.status === 'converted').length / allEstimates.length * 100}
                color="#16a34a" />
            </div>
          )}
          {estTotal !== allEstimates.length && (
            <div className="ir-est-lifetime">All-time: {estConverted} of {estTotal} estimates converted ({estRate}%)</div>
          )}
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

      <div className="print-only ir-print-header">
        <strong>{orgName}</strong> — Invoice Report {selectedYear}{selectedQ ? ` Q${selectedQ}` : ''}
        <br />Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>

      {/* ── Full-view overlay ── */}
      {fullView && (() => {
        const isInsurers = fullView === 'insurers'
        const search    = isInsurers ? insurerSearch : claimSearch
        const setSearch = isInsurers ? setInsurerSearch : setClaimSearch
        const allClaims = [...filteredSettlements].sort((a, b) => sn(b.totalSettled) - sn(a.totalSettled))
        const q = search.toLowerCase()
        const rows = isInsurers
          ? insurerData.filter(ins => !q || ins.name.toLowerCase().includes(q))
          : allClaims.filter(s =>
              !q ||
              (s.clientName || '').toLowerCase().includes(q) ||
              (s.claimNumber || '').toLowerCase().includes(q) ||
              (s.insuranceCompany || '').toLowerCase().includes(q)
            )
        return (
          <div className="ir-overlay" onClick={() => setFullView(null)}>
            <div className="ir-overlay-panel" onClick={e => e.stopPropagation()}>
              <div className="ir-overlay-header">
                <div>
                  <div className="ir-overlay-title">{isInsurers ? 'All Insurers' : 'All Claims'}</div>
                  <div className="ir-overlay-sub">
                    {selectedYear}{selectedQ ? ` Q${selectedQ}` : ''} · {rows.length} {isInsurers ? 'insurer' : 'claim'}{rows.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <button className="ir-overlay-close" onClick={() => setFullView(null)}>✕ Close</button>
              </div>
              <div className="ir-overlay-body">
                <input
                  className="ir-search-input"
                  type="text"
                  placeholder={isInsurers ? 'Search insurer…' : 'Search client, claim #, insurer…'}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                />
                {isInsurers
                  ? <InsurerTable rows={rows} />
                  : <ClaimTable rows={rows} sn={sn} />
                }
                {rows.length === 0 && <p className="ir-preview-note">No results for "{search}"</p>}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function InsurerTable({ rows }) {
  return (
    <table className="ir-table">
      <thead>
        <tr>
          <th>Insurance Company</th>
          <th className="ir-num">Claims</th>
          <th className="ir-num">Submitted</th>
          <th className="ir-num">Settled</th>
          <th className="ir-num">Recovery</th>
          <th className="ir-num">Co. Recoup</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(ins => {
          const rate = ins.submitted > 0 ? ins.settled / ins.submitted * 100 : 0
          return (
            <tr key={ins.name}>
              <td style={{ fontWeight: 600 }}>{ins.name}</td>
              <td className="ir-num">{ins.claims}</td>
              <td className="ir-num">{ins.submitted > 0 ? fmtMoney(ins.submitted) : '—'}</td>
              <td className="ir-num" style={{ color: '#16a34a' }}>{ins.settled > 0 ? fmtMoney(ins.settled) : '—'}</td>
              <td className="ir-num">
                {ins.submitted > 0
                  ? <span className="ir-rate-pill" style={{ color: rate >= 90 ? '#15803d' : rate >= 75 ? '#92400e' : '#991b1b', background: rate >= 90 ? '#dcfce7' : rate >= 75 ? '#fef9c3' : '#fee2e2' }}>{rate.toFixed(1)}%</span>
                  : '—'}
              </td>
              <td className="ir-num" style={{ color: '#2563eb', fontWeight: 700 }}>{ins.recoup > 0 ? fmtMoney(ins.recoup) : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ClaimTable({ rows, sn }) {
  return (
    <table className="ir-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Claim #</th>
          <th>Insurer</th>
          <th className="ir-num">Submitted</th>
          <th className="ir-num">Settled</th>
          <th className="ir-num">Referral Fee</th>
          <th className="ir-num">Co. Net</th>
          <th className="ir-num">Recovery</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(s => {
          const rate  = sn(s.recoveryRate)
          const pFee  = sn(s.partnerFee)
          const coNet = Math.max(0, sn(s.totalSettled) - pFee)
          return (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.clientName || '—'}</td>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.claimNumber || '—'}</td>
              <td style={{ color: '#64748b' }}>{s.insuranceCompany || '—'}</td>
              <td className="ir-num">{sn(s.totalEstimate) > 0 ? fmtMoney(s.totalEstimate) : '—'}</td>
              <td className="ir-num" style={{ color: sn(s.totalSettled) > 0 ? '#16a34a' : '#d97706' }}>
                {sn(s.totalSettled) > 0 ? fmtMoney(s.totalSettled) : 'Pending'}
              </td>
              <td className="ir-num" style={{ color: pFee > 0 ? '#7c3aed' : '#94a3b8' }}>
                {pFee > 0 ? fmtMoney(pFee) : '—'}
              </td>
              <td className="ir-num" style={{ color: '#2563eb', fontWeight: 700 }}>
                {sn(s.totalSettled) > 0 ? fmtMoney(coNet) : '—'}
              </td>
              <td className="ir-num">
                {rate > 0
                  ? <span className="ir-rate-pill" style={{ color: rate >= 90 ? '#15803d' : rate >= 75 ? '#92400e' : '#991b1b', background: rate >= 90 ? '#dcfce7' : rate >= 75 ? '#fef9c3' : '#fee2e2' }}>{rate.toFixed(1)}%</span>
                  : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

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
        {amount > 0 && <div className="ir-pill-amt" style={{ color }}>{amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
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

import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore'
import { useAuth } from './useAuth'
import './PartnerDetail.css'

const STATUS_META = {
  estimating:    { label: 'Estimating',    color: '#64748b', bg: '#f1f5f9' },
  submitted:     { label: 'Submitted',     color: '#2563eb', bg: '#eff6ff' },
  negotiating:   { label: 'Negotiating',   color: '#d97706', bg: '#fffbeb' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
  settled:       { label: 'Settled ✓',     color: '#15803d', bg: '#dcfce7' },
}

const PIPE_ORDER = ['submitted', 'negotiating', 'supplementing', 'estimating']

const CATS = [
  { key: 'dryClean',       label: 'Dry Clean' },
  { key: 'mitigation',     label: 'Mitigation' },
  { key: 'reconstruction', label: 'Reconstruction' },
  { key: 'packout',        label: 'Packout' },
]

const n   = v => parseFloat(v) || 0
const fmt = v => n(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PartnerDetail() {
  const { partnerId } = useParams()
  const navigate      = useNavigate()
  const { user }      = useAuth()

  const [loading,      setLoading]      = useState(true)
  const [partner,      setPartner]      = useState(null)
  const [settlements,  setSettlements]  = useState([])
  const [phoneMap,     setPhoneMap]     = useState({})
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [claimTab,     setClaimTab]     = useState('all')

  useEffect(() => { if (user) load() }, [user, partnerId])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return

      const partnerSnap = await getDoc(doc(db, 'organization_data', oid, 'partners', partnerId))
      if (partnerSnap.exists()) setPartner({ id: partnerSnap.id, ...partnerSnap.data() })

      const [settSnap, clientSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'organization_data', oid, 'settlement_summary'),
          where('partnerId', '==', partnerId)
        )).catch(() => ({ docs: [] })),
        getDocs(collection(db, 'organization_data', oid, 'clients')).catch(() => ({ docs: [] })),
      ])

      const pMap = {}
      clientSnap.docs.forEach(d => {
        const data = d.data()
        if (data.uid && data.phone) pMap[data.uid] = data.phone
      })
      setPhoneMap(pMap)

      const rows = settSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0))
      setSettlements(rows)
    } finally {
      setLoading(false)
    }
  }

  // ── Available years from settled claims, always include current year ──
  const availableYears = useMemo(() => {
    const years = new Set([new Date().getFullYear()])
    settlements.forEach(s => {
      if (s.settlementDate)
        years.add(new Date(s.settlementDate + 'T12:00:00').getFullYear())
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [settlements])

  // ── Open pipeline: any claim without a totalSettled amount ──
  const openClaims = useMemo(() =>
    settlements.filter(s => n(s.totalSettled) === 0),
  [settlements])

  // ── Settled claims filtered by selected year ──
  const settledClaims = useMemo(() =>
    settlements.filter(s => {
      if (n(s.totalSettled) === 0 || !s.settlementDate) return false
      return new Date(s.settlementDate + 'T12:00:00').getFullYear() === selectedYear
    }),
  [settlements, selectedYear])

  // ── Pipeline breakdown by status ──
  const pipelineByStatus = useMemo(() => {
    const map = {}
    openClaims.forEach(s => {
      const key = s.status || 'estimating'
      if (!map[key]) map[key] = { count: 0, exposure: 0 }
      map[key].count++
      map[key].exposure += n(s.totalEstimate)
    })
    return map
  }, [openClaims])

  // ── Year-filtered settled stats ──
  const totalSettledAmt   = settledClaims.reduce((s, x) => s + n(x.totalSettled), 0)
  const totalSubmittedAmt = settledClaims.reduce((s, x) => s + n(x.totalEstimate), 0)
  const totalFeeAmt       = settledClaims.reduce((s, x) => s + n(x.partnerFee), 0)
  const totalNetAmt       = totalSettledAmt - totalFeeAmt
  const avgRecovery       = settledClaims.length > 0
    ? settledClaims.reduce((s, x) => s + n(x.recoveryRate), 0) / settledClaims.length
    : 0

  // ── All-time open exposure ──
  const totalOpenExposure = openClaims.reduce((s, x) => s + n(x.totalEstimate), 0)

  // ── Claims displayed per tab ──
  const displayedClaims = useMemo(() => {
    if (claimTab === 'open')    return openClaims
    if (claimTab === 'settled') return settledClaims
    // 'all': open by priority first, then settled this year, then older settled
    const priority = { submitted: 0, negotiating: 1, supplementing: 2, estimating: 3 }
    const sortedOpen = [...openClaims].sort((a, b) => {
      const pa = priority[a.status] ?? 4, pb = priority[b.status] ?? 4
      return pa !== pb ? pa - pb : n(b.totalEstimate) - n(a.totalEstimate)
    })
    const olderSettled = settlements.filter(s => {
      if (n(s.totalSettled) === 0 || !s.settlementDate) return false
      return new Date(s.settlementDate + 'T12:00:00').getFullYear() !== selectedYear
    })
    return [...sortedOpen, ...settledClaims, ...olderSettled]
  }, [claimTab, openClaims, settledClaims, settlements, selectedYear])

  if (loading) return <div className="pd-loading"><div className="pd-spinner" /></div>
  if (!partner) return (
    <div className="pd-loading">
      <p>Partner not found. <button className="pd-back" onClick={() => navigate(-1)}>← Back</button></p>
    </div>
  )

  return (
    <div className="pd-root">
      <button className="pd-back" onClick={() => navigate('/myclaim/invoices?tab=partners')}>← Back to Partners</button>

      {/* ── Header ── */}
      <div className="pd-header">
        <div className="pd-avatar">👤</div>
        <div className="pd-header-info">
          <h2 className="pd-name">{partner.name}</h2>
          <div className="pd-contacts">
            {partner.email && <span className="pd-contact-item">✉ {partner.email}</span>}
            {partner.phone && <span className="pd-contact-item">📞 {partner.phone}</span>}
          </div>
        </div>
        <div className="pd-header-stats">
          <div className="pd-hs-cell">
            <div className="pd-hs-val">{settlements.length}</div>
            <div className="pd-hs-label">Total Jobs</div>
          </div>
          <div className="pd-hs-divider" />
          <div className="pd-hs-cell">
            <div className="pd-hs-val" style={{ color: '#d97706' }}>{openClaims.length}</div>
            <div className="pd-hs-label">Open</div>
          </div>
          <div className="pd-hs-divider" />
          <div className="pd-hs-cell">
            <div className="pd-hs-val" style={{ color: '#15803d' }}>{settlements.length - openClaims.length}</div>
            <div className="pd-hs-label">Settled</div>
          </div>
        </div>
      </div>

      {/* ── Outstanding Pipeline ── */}
      {openClaims.length > 0 && (
        <div className="pd-section">
          <div className="pd-section-title">⏳ Outstanding Pipeline</div>
          <div className="pd-pipeline-strip">
            {PIPE_ORDER.map(key => {
              const stat = pipelineByStatus[key]
              if (!stat) return null
              const sm = STATUS_META[key]
              return (
                <div key={key} className="pd-pipe-card" style={{ borderColor: sm.color + '44', background: sm.bg }}>
                  <div className="pd-pipe-status" style={{ color: sm.color }}>{sm.label}</div>
                  <div className="pd-pipe-count" style={{ color: sm.color }}>{stat.count}</div>
                  <div className="pd-pipe-unit">job{stat.count !== 1 ? 's' : ''}</div>
                  <div className="pd-pipe-exposure" style={{ color: sm.color }}>{fmt(stat.exposure)}</div>
                  <div className="pd-pipe-unit">estimated</div>
                </div>
              )
            }).filter(Boolean)}
            <div className="pd-pipe-card pd-pipe-card--total">
              <div className="pd-pipe-status">Total Exposure</div>
              <div className="pd-pipe-count">{openClaims.length}</div>
              <div className="pd-pipe-unit">open job{openClaims.length !== 1 ? 's' : ''}</div>
              <div className="pd-pipe-exposure">{fmt(totalOpenExposure)}</div>
              <div className="pd-pipe-unit">at risk</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Year filter + Settled Performance ── */}
      <div className="pd-year-row">
        <span className="pd-year-heading">Settled Performance</span>
        <div className="pd-year-pills">
          {availableYears.map(y => (
            <button
              key={y}
              className={`pd-year-pill${y === selectedYear ? ' pd-year-pill--active' : ''}`}
              onClick={() => setSelectedYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {settledClaims.length > 0 ? (
        <>
          <div className="pd-kpi-row">
            <div className="pd-kpi">
              <div className="pd-kpi-label">Claims Settled</div>
              <div className="pd-kpi-val">{settledClaims.length}</div>
              <div className="pd-kpi-sub">in {selectedYear}</div>
            </div>
            <div className="pd-kpi">
              <div className="pd-kpi-label">Total Submitted</div>
              <div className="pd-kpi-val">{fmt(totalSubmittedAmt)}</div>
              <div className="pd-kpi-sub">to insurance</div>
            </div>
            <div className="pd-kpi pd-kpi--green">
              <div className="pd-kpi-label">Total Settled</div>
              <div className="pd-kpi-val">{fmt(totalSettledAmt)}</div>
              <div className="pd-kpi-sub">{avgRecovery.toFixed(1)}% avg recovery</div>
            </div>
            <div className="pd-kpi pd-kpi--purple">
              <div className="pd-kpi-label">Referral Fees Paid</div>
              <div className="pd-kpi-val">{fmt(totalFeeAmt)}</div>
              <div className="pd-kpi-sub">to {partner.name}</div>
            </div>
            <div className="pd-kpi pd-kpi--blue">
              <div className="pd-kpi-label">Company Net</div>
              <div className="pd-kpi-val">{fmt(totalNetAmt)}</div>
              <div className="pd-kpi-sub">after referral fees</div>
            </div>
          </div>

          <div className="pd-avg-recovery-row">
            <span className="pd-avg-recovery-label">Avg Recovery Rate — {selectedYear}</span>
            <div className="pd-avg-recovery-track">
              <div
                className="pd-avg-recovery-fill"
                style={{
                  width: `${Math.min(100, avgRecovery)}%`,
                  background: avgRecovery >= 90 ? '#16a34a' : avgRecovery >= 75 ? '#d97706' : '#dc2626',
                }}
              />
            </div>
            <span className="pd-avg-recovery-pct" style={{
              color: avgRecovery >= 90 ? '#15803d' : avgRecovery >= 75 ? '#d97706' : '#dc2626',
            }}>
              {avgRecovery.toFixed(1)}%
            </span>
          </div>
        </>
      ) : (
        <div className="pd-no-data">No settled claims in {selectedYear}.</div>
      )}

      {/* ── Claims list ── */}
      <div className="pd-section">
        <div className="pd-claim-tabs">
          {[
            { key: 'all',     label: `All Claims (${settlements.length})` },
            { key: 'open',    label: `Open Pipeline (${openClaims.length})` },
            { key: 'settled', label: `Settled in ${selectedYear} (${settledClaims.length})` },
          ].map(t => (
            <button
              key={t.key}
              className={`pd-claim-tab${claimTab === t.key ? ' pd-claim-tab--active' : ''}`}
              onClick={() => setClaimTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {displayedClaims.length === 0 ? (
          <div className="pd-empty">
            <div className="pd-empty-icon">🤝</div>
            <p className="pd-empty-title">No claims</p>
            <p className="pd-empty-sub">
              {claimTab === 'settled'
                ? `No settled claims in ${selectedYear}.`
                : claimTab === 'open'
                ? 'No open claims — all settled!'
                : 'No claims tagged to this partner yet.'}
            </p>
          </div>
        ) : (
          <div className="pd-cards">
            {displayedClaims.map(s => {
              const isSettled   = n(s.totalSettled) > 0
              const sm          = STATUS_META[s.status] || STATUS_META.estimating
              const recov       = isSettled ? Math.min(100, n(s.recoveryRate)) : 0
              const clientPhone = s.clientPhone || phoneMap[s.clientUid]
              const fee         = isSettled ? n(s.partnerFee) : 0
              const net         = isSettled ? n(s.totalSettled) - fee : 0
              const gap         = Math.max(0, n(s.totalEstimate) - n(s.totalSettled))

              const catRows = CATS.map(c => ({
                label:    c.label,
                estimate: n(s[`${c.key}Estimate`]),
                settled:  n(s[`${c.key}Settled`]),
              })).filter(c => c.estimate > 0 || c.settled > 0)

              return (
                <div key={s.id} className="pd-card">

                  {/* Card header */}
                  <div className="pd-card-head">
                    <div className="pd-card-id">
                      <span className="pd-claim-num">{s.claimNumber || 'No claim #'}</span>
                      {s.insuranceCompany && <span className="pd-insurer">{s.insuranceCompany}</span>}
                    </div>
                    <div className="pd-card-head-right">
                      <span className="pd-badge" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
                      {clientPhone && (
                        <button
                          className="pd-view-btn"
                          onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(clientPhone)}/settlement`)}
                        >
                          View Claim →
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Client + dates */}
                  <div className="pd-card-meta">
                    {s.clientName && <span className="pd-client-name">👤 {s.clientName}</span>}
                    {s.dateOfLoss && <span className="pd-meta-item">📅 Loss: {fmtDate(s.dateOfLoss)}</span>}
                    {isSettled && s.settlementDate && (
                      <span className="pd-meta-item">✅ Settled: {fmtDate(s.settlementDate)}</span>
                    )}
                    {!isSettled && (
                      <span className="pd-meta-badge" style={{ color: sm.color, background: sm.bg }}>
                        Awaiting settlement
                      </span>
                    )}
                  </div>

                  {/* Metrics grid */}
                  <div className="pd-metrics-grid">
                    <div className="pd-mg-cell">
                      <div className="pd-mg-label">Estimate</div>
                      <div className="pd-mg-val">{n(s.totalEstimate) > 0 ? fmt(s.totalEstimate) : '—'}</div>
                    </div>
                    {isSettled && (
                      <>
                        <div className="pd-mg-cell">
                          <div className="pd-mg-label">Settled</div>
                          <div className="pd-mg-val" style={{ color: '#15803d' }}>{fmt(s.totalSettled)}</div>
                        </div>
                        <div className="pd-mg-cell">
                          <div className="pd-mg-label">Gap</div>
                          <div className="pd-mg-val" style={{ color: gap > 0 ? '#dc2626' : '#94a3b8' }}>
                            {gap > 0 ? `– ${fmt(gap)}` : '—'}
                          </div>
                        </div>
                        <div className="pd-mg-cell">
                          <div className="pd-mg-label">Referral Fee</div>
                          <div className="pd-mg-val" style={{ color: '#7c3aed' }}>{fee > 0 ? `– ${fmt(fee)}` : '—'}</div>
                        </div>
                        <div className="pd-mg-cell">
                          <div className="pd-mg-label">Co. Net</div>
                          <div className="pd-mg-val" style={{ color: '#1d4ed8', fontWeight: 800 }}>{fmt(net)}</div>
                        </div>
                        <div className="pd-mg-cell">
                          <div className="pd-mg-label">Recovery</div>
                          <div className="pd-mg-val" style={{
                            color: recov >= 90 ? '#15803d' : recov >= 75 ? '#d97706' : '#dc2626',
                          }}>
                            {recov.toFixed(1)}%
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Category breakdown */}
                  {catRows.length > 0 && (
                    <div className="pd-cat-breakdown">
                      <div className="pd-cat-title">Category Breakdown</div>
                      {catRows.map(c => (
                        <div key={c.label} className="pd-cat-row">
                          <span className="pd-cat-label">{c.label}</span>
                          <span className="pd-cat-est">{c.estimate > 0 ? fmt(c.estimate) : '—'}</span>
                          {isSettled && (
                            <>
                              <span className="pd-cat-arrow">→</span>
                              <span className="pd-cat-sett" style={{ color: '#15803d' }}>
                                {c.settled > 0 ? fmt(c.settled) : '—'}
                              </span>
                              {c.estimate > 0 && c.settled > 0 && (
                                <span className="pd-cat-rate" style={{
                                  color: c.settled / c.estimate >= 0.9
                                    ? '#15803d'
                                    : c.settled / c.estimate >= 0.75
                                    ? '#d97706'
                                    : '#dc2626',
                                }}>
                                  {(c.settled / c.estimate * 100).toFixed(0)}%
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recovery bar */}
                  {isSettled && (
                    <div className="pd-bar-wrap">
                      <div className="pd-bar">
                        <div className="pd-bar-fill" style={{
                          width: `${recov}%`,
                          background: recov >= 90 ? '#16a34a' : recov >= 75 ? '#d97706' : '#dc2626',
                        }} />
                      </div>
                      <span className="pd-bar-label" style={{
                        color: recov >= 90 ? '#15803d' : recov >= 75 ? '#d97706' : '#dc2626',
                      }}>
                        {recov.toFixed(1)}% recovered
                      </span>
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

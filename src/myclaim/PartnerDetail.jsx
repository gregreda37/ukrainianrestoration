import { useState, useEffect } from 'react'
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

const n = v => parseFloat(v) || 0
const fmt = v => n(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PartnerDetail() {
  const { partnerId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading,      setLoading]      = useState(true)
  const [partner,      setPartner]      = useState(null)
  const [settlements,  setSettlements]  = useState([])
  const [phoneMap,     setPhoneMap]     = useState({}) // clientUid → phone

  useEffect(() => { if (user) load() }, [user, partnerId])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return

      // Fetch partner doc first — don't let settlements query failure block it
      const partnerSnap = await getDoc(doc(db, 'organization_data', oid, 'partners', partnerId))
      if (partnerSnap.exists()) setPartner({ id: partnerSnap.id, ...partnerSnap.data() })

      const [settSnap, clientSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'organization_data', oid, 'settlement_summary'),
          where('partnerId', '==', partnerId)
        )).catch(() => ({ docs: [] })),
        getDocs(collection(db, 'organization_data', oid, 'clients')).catch(() => ({ docs: [] })),
      ])

      // Build uid → phone map from clients collection
      const pMap = {}
      clientSnap.docs.forEach(d => {
        const data = d.data()
        if (data.uid && data.phone) pMap[data.uid] = data.phone
      })
      setPhoneMap(pMap)

      // Sort by updatedAt descending client-side (avoids composite index requirement)
      const rows = settSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => {
        const ta = a.updatedAt?.seconds ?? 0
        const tb = b.updatedAt?.seconds ?? 0
        return tb - ta
      })
      setSettlements(rows)
    } finally {
      setLoading(false)
    }
  }

  // ── Aggregate stats ──
  const settled    = settlements.filter(s => n(s.totalSettled) > 0)
  const totalSub   = settlements.reduce((s, x) => s + n(x.totalEstimate), 0)
  const totalSet   = settled.reduce((s, x) => s + n(x.totalSettled), 0)
  const totalFee   = settled.reduce((s, x) => s + n(x.partnerFee), 0)
  const totalNet   = totalSet - totalFee
  const avgRecov   = settled.length > 0
    ? settled.reduce((s, x) => s + n(x.recoveryRate), 0) / settled.length
    : 0

  if (loading) return <div className="pd-loading"><div className="pd-spinner" /></div>
  if (!partner) return (
    <div className="pd-loading">
      <p>Partner not found. <button className="pd-back" onClick={() => navigate(-1)}>← Back</button></p>
    </div>
  )

  return (
    <div className="pd-root">
      <button className="pd-back" onClick={() => navigate('/myclaim/invoices?tab=partners')}>← Back</button>

      {/* ── Header ── */}
      <div className="pd-header">
        <div className="pd-avatar">👤</div>
        <div>
          <h2 className="pd-name">{partner.name}</h2>
          {partner.email && <p className="pd-contact">{partner.email}</p>}
          {partner.phone && <p className="pd-contact">{partner.phone}</p>}
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="pd-kpi-row">
        <div className="pd-kpi">
          <div className="pd-kpi-label">Total Jobs</div>
          <div className="pd-kpi-val">{settlements.length}</div>
          <div className="pd-kpi-sub">{settled.length} settled</div>
        </div>
        <div className="pd-kpi">
          <div className="pd-kpi-label">Total Submitted</div>
          <div className="pd-kpi-val">{fmt(totalSub)}</div>
          <div className="pd-kpi-sub">to insurance</div>
        </div>
        <div className="pd-kpi pd-kpi--green">
          <div className="pd-kpi-label">Total Settled</div>
          <div className="pd-kpi-val">{fmt(totalSet)}</div>
          <div className="pd-kpi-sub">{avgRecov > 0 ? `${avgRecov.toFixed(1)}% avg recovery` : '—'}</div>
        </div>
        <div className="pd-kpi pd-kpi--purple">
          <div className="pd-kpi-label">Referral Fees Paid</div>
          <div className="pd-kpi-val">{fmt(totalFee)}</div>
          <div className="pd-kpi-sub">to {partner.name}</div>
        </div>
        <div className="pd-kpi pd-kpi--blue">
          <div className="pd-kpi-label">Company Net</div>
          <div className="pd-kpi-val">{fmt(totalNet)}</div>
          <div className="pd-kpi-sub">after referral fees</div>
        </div>
      </div>

      {/* ── Settlement cards ── */}
      {settlements.length === 0 ? (
        <div className="pd-empty">
          <div className="pd-empty-icon">🤝</div>
          <p className="pd-empty-title">No settlements yet</p>
          <p className="pd-empty-sub">Claims tagged to {partner.name} will appear here.</p>
        </div>
      ) : (
        <div className="pd-cards">
          {settlements.map(s => {
            const isSettled  = n(s.totalSettled) > 0
            const sm         = STATUS_META[s.status] || STATUS_META.estimating
            const recov      = isSettled ? Math.min(100, n(s.recoveryRate)) : 0
            const clientPhone = phoneMap[s.clientUid]
            const fee        = isSettled ? n(s.partnerFee) : 0
            const net        = isSettled ? n(s.totalSettled) - fee : 0

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
                  {s.dateOfLoss && <span className="pd-meta-item">Loss: {fmtDate(s.dateOfLoss)}</span>}
                  {s.settlementDate && <span className="pd-meta-item">Settled: {fmtDate(s.settlementDate)}</span>}
                </div>

                {/* Metrics */}
                <div className="pd-metrics">
                  {[
                    { label: 'Estimated',  val: s.totalEstimate, color: '#0f172a' },
                    { label: 'Settled',    val: s.totalSettled,  color: '#16a34a' },
                    { label: 'Gap',        val: s.gap,           color: '#dc2626', prefix: n(s.gap) > 0 ? '–' : '' },
                    { label: 'Referral',   val: fee,             color: '#7c3aed' },
                    { label: 'Co. Net',    val: net,             color: '#2563eb' },
                  ].filter(m => n(m.val) > 0).map(m => (
                    <div key={m.label} className="pd-metric">
                      <span className="pd-metric-label">{m.label}</span>
                      <span className="pd-metric-val" style={{ color: m.color }}>
                        {m.prefix}{fmt(m.val)}
                      </span>
                    </div>
                  ))}
                  {isSettled && (
                    <div className="pd-metric">
                      <span className="pd-metric-label">Recovery</span>
                      <span className="pd-metric-val" style={{
                        color: recov >= 90 ? '#15803d' : recov >= 75 ? '#d97706' : '#dc2626'
                      }}>
                        {recov.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

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
                      color: recov >= 90 ? '#15803d' : recov >= 75 ? '#d97706' : '#dc2626'
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
  )
}

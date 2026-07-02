import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { useAuth } from './useAuth'
import InvoiceReport from './InvoiceReport'
import './OrgInvoices.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Partners Overview ─────────────────────────────────────────────────────────

function PartnersOverview() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading,   setLoading]   = useState(true)
  const [partners,  setPartners]  = useState([])
  const [statsMap,  setStatsMap]  = useState({})

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

      <div className="po-list">
        <div className="po-list-header">
          <span className="po-lh-name">Partner</span>
          <span className="po-lh-num">Jobs</span>
          <span className="po-lh-num">Submitted</span>
          <span className="po-lh-num">Settled</span>
          <span className="po-lh-num">Fees Paid</span>
          <span className="po-lh-num">Co. Net</span>
          <span className="po-lh-action" />
        </div>

        {partners.map(p => {
          const st  = statsMap[p.id] || { claims: 0, submitted: 0, settled: 0, fee: 0 }
          const net = st.settled - st.fee

          return (
            <div key={p.id} className="po-list-row" onClick={() => navigate(`/myclaim/partners/${p.id}`)}>
              <div className="po-lr-name">
                <div className="po-lr-avatar">👤</div>
                <div>
                  <div className="po-lr-label">{p.name}</div>
                  {p.email && <div className="po-lr-contact">{p.email}</div>}
                  {p.phone && <div className="po-lr-contact">{p.phone}</div>}
                </div>
              </div>

              <div className="po-lr-num">
                <div className="po-lr-val">{st.claims || '—'}</div>
                <div className="po-lr-sub">referred</div>
              </div>
              <div className="po-lr-num">
                <div className="po-lr-val">{st.submitted > 0 ? fmtMoney(st.submitted) : '—'}</div>
                <div className="po-lr-sub">to insurance</div>
              </div>
              <div className="po-lr-num">
                <div className="po-lr-val" style={{ color: '#15803d' }}>{st.settled > 0 ? fmtMoney(st.settled) : '—'}</div>
                <div className="po-lr-sub">from insurer</div>
              </div>
              <div className="po-lr-num">
                <div className="po-lr-val" style={{ color: '#7c3aed' }}>{st.fee > 0 ? fmtMoney(st.fee) : '—'}</div>
                <div className="po-lr-sub">referral fee</div>
              </div>
              <div className="po-lr-num">
                <div className="po-lr-val" style={{ color: '#1d4ed8', fontWeight: 800 }}>{net > 0 ? fmtMoney(net) : '—'}</div>
                <div className="po-lr-sub">after fee</div>
              </div>
              <div className="po-lr-action">→</div>
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
    return ['report', 'partners'].includes(t) ? t : 'report'
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
          className={`oi-tab${tab === 'partners' ? ' oi-tab--active' : ''}`}
          onClick={() => setTab('partners')}
        >
          🤝 Partners
        </button>
      </div>

      <div className="oi-content">
        {tab === 'report'   && <InvoiceReport embedded />}
        {tab === 'partners' && <PartnersOverview />}
      </div>
    </div>
  )
}

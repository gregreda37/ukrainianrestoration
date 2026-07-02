import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, collection, getDocs, addDoc, setDoc, serverTimestamp, query, orderBy } from 'firebase/firestore'
import InsurerCombobox from './InsurerCombobox'
import './SettlementOverviewCard.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'dryClean',       label: 'Dry Cleaning / Contents' },
  { key: 'mitigation',     label: 'Mitigation'               },
  { key: 'reconstruction', label: 'Reconstruction'           },
  { key: 'packout',        label: 'Packout'                  },
]

const COL_FIELDS = [
  { key: 'Estimate',   label: 'Our Estimate', color: '#0f172a' },
  { key: 'Supplement', label: 'Supplement',   color: '#0891b2' },
  { key: 'Settled',    label: 'Settled',      color: '#16a34a' },
]

const STATUS_META = {
  estimating:    { label: 'Estimating',    color: '#64748b', bg: '#f1f5f9' },
  submitted:     { label: 'Submitted',     color: '#2563eb', bg: '#eff6ff' },
  negotiating:   { label: 'Negotiating',   color: '#d97706', bg: '#fffbeb' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
  settled:       { label: 'Settled ✓',     color: '#15803d', bg: '#dcfce7' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const n = v => parseFloat(v) || 0
const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function computeTotals(form) {
  const totals = {}
  for (const col of COL_FIELDS) {
    totals[col.key] = CATEGORIES.reduce((s, cat) => s + n(form[`${cat.key}${col.key}`]), 0)
  }
  totals.gap          = Math.max(0, totals.Estimate - totals.Settled)
  totals.recoveryRate = totals.Estimate > 0 ? totals.Settled / totals.Estimate * 100 : 0
  return totals
}

function buildEmptyForm(prefill) {
  const base = {
    claimNumber:           prefill.claimNumber      || '',
    policyNumber:          prefill.policyNumber     || '',
    dateOfLoss:            prefill.dateOfLoss       || '',
    settlementDate:        '',
    insuranceCompany:      prefill.insuranceCompany || '',
    adjusterName:          prefill.adjusterName     || '',
    adjusterPhone:         prefill.adjusterPhone    || '',
    adjusterEmail:         prefill.adjusterEmail    || '',
    status:                'estimating',
    deductible:            '',
    recoupPercent:         0,
    dryCleanRecoupPct:     '',
    mitigationRecoupPct:   '',
    reconstructionRecoupPct: '',
    packoutRecoupPct:      '',
    partnerId:             '',
    partnerName:           '',
    partnerFeeType:        'percent',
    partnerFeeValue:       '',
    notes:                 '',
  }
  for (const cat of CATEGORIES) {
    for (const col of COL_FIELDS) {
      base[`${cat.key}${col.key}`] = ''
    }
  }
  return base
}

function computeCategoryRecoups(form) {
  const masterPct = n(form.recoupPercent)
  let companyRecoup = 0
  const breakdown = CATEGORIES.map(cat => {
    const settled = n(form[`${cat.key}Settled`])
    const override = form[`${cat.key}RecoupPct`]
    const pct = (override !== null && override !== undefined && override !== '') ? n(override) : masterPct
    const recoup = settled * pct / 100
    companyRecoup += recoup
    return { key: cat.key, label: cat.label, settled, pct, recoup }
  })
  return { breakdown, companyRecoup }
}

function computePartnerFee(form, companyRecoup) {
  if (!form.partnerId) return 0
  const type = form.partnerFeeType || 'percent'
  const val  = n(form.partnerFeeValue)
  return type === 'fixed' ? val : companyRecoup * val / 100
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettlementOverviewCard({ clientUid, clientDocId, clientName, orgId, phone, prefill = {}, insurers = [] }) {
  const navigate = useNavigate()
  const prevPrefillRef = useRef(null)

  const [loading,     setLoading]     = useState(true)
  const [settlements, setSettlements] = useState([])
  const [partners,    setPartners]    = useState([])
  const [showForm,    setShowForm]    = useState(false)
  const [form,        setForm]        = useState(() => buildEmptyForm(prefill))
  const [saving,      setSaving]      = useState(false)

  // When adjuster/claim data loads asynchronously in the parent, update blank form fields
  useEffect(() => {
    const prev = prevPrefillRef.current
    if (
      prev &&
      prev.claimNumber      === prefill.claimNumber &&
      prev.insuranceCompany === prefill.insuranceCompany &&
      prev.adjusterName     === prefill.adjusterName
    ) return
    prevPrefillRef.current = { ...prefill }

    setForm(f => ({
      ...f,
      claimNumber:      f.claimNumber      || prefill.claimNumber      || '',
      policyNumber:     f.policyNumber     || prefill.policyNumber     || '',
      insuranceCompany: f.insuranceCompany || prefill.insuranceCompany || '',
      adjusterName:     f.adjusterName     || prefill.adjusterName     || '',
      adjusterPhone:    f.adjusterPhone    || prefill.adjusterPhone    || '',
      adjusterEmail:    f.adjusterEmail    || prefill.adjusterEmail    || '',
    }))
  }, [prefill.claimNumber, prefill.insuranceCompany, prefill.adjusterName, prefill.policyNumber])

  useEffect(() => {
    if (clientUid || (orgId && clientDocId)) load()
    else setLoading(false)
  }, [clientUid, clientDocId, orgId])

  async function load() {
    setLoading(true)
    try {
      if (orgId) {
        const partnerSnap = await getDocs(query(collection(db, 'organization_data', orgId, 'partners'), orderBy('name', 'asc'))).catch(() => ({ docs: [] }))
        setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      }
      if (clientUid) {
        // Post-login: load from user path + merge any pre-login org-path settlements
        const promises = [
          getDocs(query(collection(db, 'users', clientUid, 'settlements'), orderBy('createdAt', 'desc'))),
          orgId && clientDocId
            ? getDocs(query(collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements'), orderBy('createdAt', 'desc'))).catch(() => null)
            : Promise.resolve(null),
        ]
        const [userSnap, orgSnap] = await Promise.all(promises)
        const userSets = userSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const orgSets  = orgSnap?.docs.map(d => ({ id: d.id, _isOrgSettlement: true, ...d.data() })) || []
        const seenIds  = new Set(userSets.map(s => s.id))
        setSettlements([...userSets, ...orgSets.filter(s => !seenIds.has(s.id))])
      } else {
        // Pre-login: load only from org path
        const snap = await getDocs(
          query(collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements'), orderBy('createdAt', 'desc'))
        ).catch(() => null)
        setSettlements(snap?.docs.map(d => ({ id: d.id, _isOrgSettlement: true, ...d.data() })) || [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function doSave() {
    if (!clientUid && !(orgId && clientDocId)) return
    setSaving(true)
    try {
      const totals = computeTotals(form)
      const hasSettled = totals.Settled > 0
      const masterPct = n(form.recoupPercent)
      const recoups = computeCategoryRecoups(form)
      const partnerFee = hasSettled ? computePartnerFee(form, recoups.companyRecoup) : 0
      // Auto-set settlementDate if settled with no date
      const settlementDate = form.settlementDate || (hasSettled && form.status === 'settled' ? new Date().toISOString().slice(0, 10) : '')
      const data = {
        ...form,
        settlementDate,
        totalEstimate:               totals.Estimate,
        totalSettled:                totals.Settled,
        recoveryRate:                hasSettled ? totals.recoveryRate : null,
        gap:                         hasSettled ? totals.gap          : null,
        companyRecoup:               hasSettled ? recoups.companyRecoup : null,
        dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
        mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
        reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
        packoutCompanyRecoup:        hasSettled ? recoups.breakdown[3]?.recoup : null,
        partnerFee:                  hasSettled && form.partnerId ? partnerFee : null,
        companyNetAfterPartner:      hasSettled ? recoups.companyRecoup - (form.partnerId ? partnerFee : 0) : null,
        createdAt:                   serverTimestamp(),
        updatedAt:                   serverTimestamp(),
      }
      const colRef = clientUid
        ? collection(db, 'users', clientUid, 'settlements')
        : collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements')
      const ref = await addDoc(colRef, data)
      if (orgId) {
        setDoc(doc(db, 'organization_data', orgId, 'settlement_summary', ref.id), {
          settlementId:                ref.id,
          clientUid:                   clientUid || '',
          clientName:                  clientName || '',
          claimNumber:                 data.claimNumber            || '',
          insuranceCompany:            data.insuranceCompany       || '',
          status:                      data.status                 || 'estimating',
          dateOfLoss:                  data.dateOfLoss             || '',
          settlementDate:              settlementDate              || '',
          dryCleanEstimate:            n(data.dryCleanEstimate),
          mitigationEstimate:          n(data.mitigationEstimate),
          reconstructionEstimate:      n(data.reconstructionEstimate),
          packoutEstimate:             n(data.packoutEstimate),
          dryCleanSettled:             n(data.dryCleanSettled),
          mitigationSettled:           n(data.mitigationSettled),
          reconstructionSettled:       n(data.reconstructionSettled),
          packoutSettled:              n(data.packoutSettled),
          totalEstimate:               totals.Estimate,
          totalSettled:                totals.Settled,
          recoveryRate:                hasSettled ? totals.recoveryRate : null,
          gap:                         hasSettled ? totals.gap          : null,
          recoupPercent:               masterPct,
          dryCleanRecoupPct:           hasSettled ? (recoups.breakdown[0]?.pct ?? null) : null,
          mitigationRecoupPct:         hasSettled ? (recoups.breakdown[1]?.pct ?? null) : null,
          reconstructionRecoupPct:     hasSettled ? (recoups.breakdown[2]?.pct ?? null) : null,
          packoutRecoupPct:            hasSettled ? (recoups.breakdown[3]?.pct ?? null) : null,
          dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
          mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
          reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
          packoutCompanyRecoup:        hasSettled ? recoups.breakdown[3]?.recoup : null,
          companyRecoup:               hasSettled ? recoups.companyRecoup : null,
          partnerId:                   data.partnerId   || null,
          partnerName:                 data.partnerName || null,
          partnerFeeType:              data.partnerFeeType  || 'percent',
          partnerFeeValue:             n(data.partnerFeeValue),
          partnerFee:                  hasSettled && data.partnerId ? partnerFee : null,
          companyNetAfterPartner:      hasSettled ? recoups.companyRecoup - (data.partnerId ? partnerFee : 0) : null,
          updatedAt:                   serverTimestamp(),
        }).catch(e => console.warn('settlement_summary create:', e))
      }
      setSettlements(prev => [{ id: ref.id, _isOrgSettlement: !clientUid, ...data }, ...prev])
      setShowForm(false)
      setForm(buildEmptyForm(prefill))
    } finally {
      setSaving(false)
    }
  }

  function cancelForm() {
    setShowForm(false)
    setForm(buildEmptyForm(prefill))
  }

  const encoded = encodeURIComponent(phone)
  const fullPage = `/myclaim/clients/${encoded}/settlement`

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="sovc-card">
      <div className="sovc-header">
        <div className="sovc-title-wrap">
          <span className="sovc-title">🏛️ Insurance Settlement</span>
          {!loading && settlements.length > 0 && (
            <button className="sovc-text-btn" onClick={() => navigate(fullPage)}>
              Full details & log →
            </button>
          )}
        </div>
        <button
          className={`sovc-add-btn${showForm ? ' sovc-add-btn--cancel' : ''}`}
          onClick={() => showForm ? cancelForm() : setShowForm(true)}
        >
          {showForm ? '✕ Cancel' : '+ Track Claim'}
        </button>
      </div>

      {/* ── Existing settlements ── */}
      {loading ? (
        <p className="sovc-hint">Loading…</p>
      ) : settlements.length === 0 && !showForm ? (
        <div className="sovc-empty">
          <p className="sovc-empty-msg">No insurance settlements tracked yet.</p>
          <p className="sovc-hint">Claim info and adjuster details will be pre-filled from above.</p>
        </div>
      ) : (
        <div className="sovc-list">
          {settlements.map(s => {
            const t   = computeTotals(s)
            const sm  = STATUS_META[s.status] || STATUS_META.estimating
            const pct = Math.min(100, t.recoveryRate)
            return (
              <div key={s.id} className="sovc-row">
                <div className="sovc-row-head">
                  <div className="sovc-row-id">
                    <span className="sovc-claim-num">{s.claimNumber || 'No claim #'}</span>
                    {s.insuranceCompany && <span className="sovc-insurer">{s.insuranceCompany}</span>}
                    {s.dateOfLoss && <span className="sovc-loss-date">Loss: {s.dateOfLoss}</span>}
                  </div>
                  <div className="sovc-row-right">
                    <span className="sovc-badge" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
                    {(n(s.dryCleanSettled) > 0 || n(s.mitigationSettled) > 0 || n(s.reconstructionSettled) > 0 || n(s.packoutSettled) > 0) && (
                      <button className="sovc-receipt-btn" onClick={() => {
                        const items = [
                          n(s.dryCleanSettled)       > 0 && { label: 'Dry Cleaning / Contents', unit: 'total', price: n(s.dryCleanSettled) },
                          n(s.mitigationSettled)     > 0 && { label: 'Mitigation',               unit: 'total', price: n(s.mitigationSettled) },
                          n(s.reconstructionSettled) > 0 && { label: 'Reconstruction',            unit: 'total', price: n(s.reconstructionSettled) },
                          n(s.packoutSettled)        > 0 && { label: 'Packout',                   unit: 'total', price: n(s.packoutSettled) },
                        ].filter(Boolean)
                        navigate(
                          `/myclaim/clients/${encodeURIComponent(phone)}/invoices/new`,
                          { state: {
                            prefillType:  'receipt',
                            prefillNotes: `Insurance settlement receipt — Claim ${s.claimNumber || ''}${s.insuranceCompany ? ` (${s.insuranceCompany})` : ''}`,
                            prefillItems: items,
                          }}
                        )
                      }}>🧾 Receipt</button>
                    )}
                    <button className="sovc-text-btn" onClick={() => navigate(fullPage)}>Details →</button>
                  </div>
                </div>

                <div className="sovc-metrics">
                  {[
                    { label: 'Estimated', val: t.Estimate,      color: '#0f172a' },
                    { label: 'ACV',       val: t.ACV,           color: '#d97706' },
                    { label: 'Settled',   val: t.Settled,       color: '#16a34a' },
                    { label: 'Gap',       val: t.gap,           color: '#dc2626', prefix: t.gap > 0 ? '–' : '' },
                  ].filter(m => m.val > 0).map(m => (
                    <div key={m.label} className="sovc-metric">
                      <span className="sovc-metric-label">{m.label}</span>
                      <span className="sovc-metric-val" style={{ color: m.color }}>
                        {m.prefix}{fmtMoney(m.val)}
                      </span>
                    </div>
                  ))}
                  {t.Settled > 0 && (
                    <div className="sovc-metric">
                      <span className="sovc-metric-label">Recovery</span>
                      <span className="sovc-metric-val" style={{
                        color: pct >= 90 ? '#15803d' : pct >= 75 ? '#d97706' : '#dc2626'
                      }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                {t.Settled > 0 && (
                  <div className="sovc-bar-wrap">
                    <div className="sovc-bar">
                      {t.ACV > 0 && (
                        <div className="sovc-bar-segment sovc-bar-segment--acv"
                          style={{ width: `${Math.min(100, t.ACV / t.Estimate * 100)}%` }} />
                      )}
                      <div className="sovc-bar-segment sovc-bar-segment--settled"
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className="sovc-bar-label" style={{
                      color: pct >= 90 ? '#15803d' : pct >= 75 ? '#d97706' : '#dc2626'
                    }}>{pct.toFixed(1)}% recovered</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── New claim inline form ── */}
      {showForm && (
        <div className="sovc-form">
          <div className="sovc-form-section-label">Prefilled from claim info — edit as needed</div>

          <div className="sovc-form-grid">
            {[
              { key: 'claimNumber',    label: 'Claim Number',         placeholder: 'e.g. CLM-2024-00123', type: 'text'   },
              { key: 'policyNumber',   label: 'Policy Number',        placeholder: 'e.g. POL-987654',     type: 'text'   },
              { key: 'dateOfLoss',     label: 'Date of Loss',         placeholder: '',                    type: 'date'   },
              { key: 'settlementDate', label: 'Settlement Date',      placeholder: '',                    type: 'date'   },
              { key: 'adjusterName',   label: 'Adjuster Name',        placeholder: 'Full name',           type: 'text'   },
              { key: 'adjusterPhone',  label: 'Adjuster Phone',       placeholder: '(555) 000-0000',      type: 'tel'    },
              { key: 'adjusterEmail',  label: 'Adjuster Email',       placeholder: 'adjuster@insurer.com',type: 'email'  },
              { key: 'deductible',     label: 'Client Deductible ($)',placeholder: '0.00',                type: 'number' },
            ].map(f => (
              <div key={f.key} className="sovc-field">
                <label className="sovc-label">{f.label}</label>
                <input
                  className={`sovc-input${form[f.key] && f.key !== 'deductible' && (
                    f.key === 'claimNumber'  && prefill.claimNumber  ||
                    f.key === 'policyNumber' && prefill.policyNumber ||
                    f.key === 'adjusterName' && prefill.adjusterName ||
                    f.key === 'adjusterPhone'&& prefill.adjusterPhone||
                    f.key === 'adjusterEmail'&& prefill.adjusterEmail
                  ) ? ' sovc-input--prefilled' : ''}`}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  min={f.type === 'number' ? 0 : undefined}
                  step={f.type === 'number' ? '0.01' : undefined}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="sovc-field">
              <label className="sovc-label">Insurance Company</label>
              <InsurerCombobox
                className={`sovc-input${form.insuranceCompany && prefill.insuranceCompany ? ' sovc-input--prefilled' : ''}`}
                value={form.insuranceCompany}
                onChange={v => setForm(p => ({ ...p, insuranceCompany: v }))}
                insurers={insurers}
                placeholder="Search or type insurer…"
              />
            </div>
            <div className="sovc-field">
              <label className="sovc-label">Status</label>
              <select className="sovc-input" value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                {Object.entries(STATUS_META).map(([v, m]) => (
                  <option key={v} value={v}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount table */}
          <div className="sovc-table-label">Claim Amounts by Category</div>
          <div className="sovc-table-scroll">
            <table className="sovc-table">
              <thead>
                <tr>
                  <th className="sovc-th-cat">Category</th>
                  {COL_FIELDS.map(f => (
                    <th key={f.key} className="sovc-th-num" style={{ color: f.color }} title={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map(cat => (
                  <tr key={cat.key}>
                    <td className="sovc-td-cat">{cat.label}</td>
                    {COL_FIELDS.map(f => (
                      <td key={f.key} className="sovc-td-amt">
                        <input
                          className="sovc-amount-input"
                          type="number" min="0" step="0.01"
                          placeholder="—"
                          value={form[`${cat.key}${f.key}`]}
                          onChange={e => setForm(p => ({ ...p, [`${cat.key}${f.key}`]: e.target.value }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(() => {
                  const t = computeTotals(form)
                  return (
                    <tr className="sovc-tfoot-row">
                      <td className="sovc-td-cat">Total</td>
                      {COL_FIELDS.map(f => (
                        <td key={f.key} className="sovc-td-amt" style={{ color: f.color, fontWeight: 700 }}>
                          {t[f.key] > 0 ? fmtMoney(t[f.key]) : '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })()}
              </tfoot>
            </table>
          </div>

          {/* Profit Recoup - per category */}
          <div className="sovc-recoup-block">
            <div className="sovc-recoup-section-title">Profit Recoup</div>

            {/* Master slider */}
            <div className="sovc-recoup-master-row">
              <div className="sovc-recoup-header">
                <label className="sovc-label">Master Default</label>
                <span className="sovc-recoup-pct">{n(form.recoupPercent)}%</span>
              </div>
              <input type="range" min="0" max="100" step="5"
                className="sovc-recoup-slider"
                value={n(form.recoupPercent)}
                onChange={e => setForm(p => ({ ...p, recoupPercent: Number(e.target.value) }))} />
              <div className="sovc-recoup-labels">
                <span>0% — partner keeps all</span>
                <span>50/50</span>
                <span>100% — we keep all</span>
              </div>
            </div>

            {/* Per-category overrides */}
            <div className="sovc-recoup-cats">
              <div className="sovc-recoup-cats-label">Per-Category Overrides (blank = use master)</div>
              {CATEGORIES.map(cat => {
                const fieldKey = `${cat.key}RecoupPct`
                const val = form[fieldKey]
                const masterPct = n(form.recoupPercent)
                const effectivePct = (val !== null && val !== undefined && val !== '') ? n(val) : masterPct
                const settled = n(form[`${cat.key}Settled`])
                const recoup = settled * effectivePct / 100
                return (
                  <div key={cat.key} className="sovc-recoup-cat-row">
                    <span className="sovc-recoup-cat-name">{cat.label}</span>
                    <div className="sovc-recoup-cat-input-wrap">
                      <input
                        type="number" min="0" max="100" step="1"
                        className="sovc-amount-input sovc-recoup-cat-input"
                        placeholder={`${masterPct}% (master)`}
                        value={val ?? ''}
                        onChange={e => setForm(p => ({ ...p, [fieldKey]: e.target.value }))}
                      />
                      <span className="sovc-recoup-cat-unit">%</span>
                    </div>
                    {settled > 0 && (
                      <span className="sovc-recoup-cat-preview">
                        → {fmtMoney(recoup)} ({effectivePct}%)
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Total recoup preview */}
            {(() => {
              const t = computeTotals(form)
              if (t.Settled <= 0) return null
              const { companyRecoup } = computeCategoryRecoups(form)
              return (
                <div className="sovc-recoup-total-preview">
                  <span>Company recoup total: <strong>{fmtMoney(companyRecoup)}</strong></span>
                  <span className="sovc-recoup-split-note">(of {fmtMoney(t.Settled)} settled)</span>
                </div>
              )
            })()}
          </div>

          {/* Partner / Referral */}
          <div className="sovc-partner-block">
            <div className="sovc-recoup-section-title">Partner / Referral Fee</div>
            <div className="sovc-partner-grid">
              <div className="sovc-field">
                <label className="sovc-label">Who brought this job?</label>
                <select className="sovc-input" value={form.partnerId || ''} onChange={e => {
                  const pid = e.target.value
                  const pname = partners.find(p => p.id === pid)?.name || ''
                  setForm(prev => ({ ...prev, partnerId: pid, partnerName: pname }))
                }}>
                  <option value="">No partner</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {form.partnerId && (
                <>
                  <div className="sovc-field">
                    <label className="sovc-label">Referral Fee Type</label>
                    <div className="sovc-toggle-row">
                      <button type="button"
                        className={`sovc-toggle-btn${(form.partnerFeeType || 'percent') === 'percent' ? ' sovc-toggle-btn--active' : ''}`}
                        onClick={() => setForm(p => ({ ...p, partnerFeeType: 'percent' }))}>% of Recoup</button>
                      <button type="button"
                        className={`sovc-toggle-btn${form.partnerFeeType === 'fixed' ? ' sovc-toggle-btn--active' : ''}`}
                        onClick={() => setForm(p => ({ ...p, partnerFeeType: 'fixed' }))}>Fixed $</button>
                    </div>
                  </div>
                  <div className="sovc-field">
                    <label className="sovc-label">{form.partnerFeeType === 'fixed' ? 'Fixed Fee ($)' : 'Fee (%)'}</label>
                    <input className="sovc-input" type="number" min="0" step={form.partnerFeeType === 'fixed' ? '1' : '0.5'}
                      placeholder={form.partnerFeeType === 'fixed' ? '0.00' : '10'}
                      value={form.partnerFeeValue || ''}
                      onChange={e => setForm(p => ({ ...p, partnerFeeValue: e.target.value }))} />
                  </div>
                </>
              )}
            </div>
            {(() => {
              if (!form.partnerId) return null
              const t = computeTotals(form)
              if (t.Settled <= 0) return null
              const { companyRecoup } = computeCategoryRecoups(form)
              const fee = computePartnerFee(form, companyRecoup)
              return (
                <div className="sovc-partner-preview">
                  <span>{partners.find(p => p.id === form.partnerId)?.name || 'Partner'} earns: <strong>{fmtMoney(fee)}</strong></span>
                  <span className="sovc-partner-net">Company net after partner: <strong style={{ color: '#2563eb' }}>{fmtMoney(companyRecoup - fee)}</strong></span>
                </div>
              )
            })()}
          </div>

          <div className="sovc-notes-row">
            <div className="sovc-field" style={{ flex: 1 }}>
              <label className="sovc-label">Notes</label>
              <textarea className="sovc-textarea" rows={2} value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Internal notes about this claim…" />
            </div>
          </div>

          <div className="sovc-form-actions">
            <button className="sovc-btn sovc-btn--outline" onClick={cancelForm}>Cancel</button>
            <button className="sovc-btn sovc-btn--primary" onClick={doSave} disabled={saving}>
              {saving ? 'Saving…' : 'Create Settlement'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

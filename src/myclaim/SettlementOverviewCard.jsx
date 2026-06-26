import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { doc, collection, getDocs, addDoc, setDoc, serverTimestamp, query, orderBy } from 'firebase/firestore'
import './SettlementOverviewCard.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'dryClean',       label: 'Dry Cleaning / Contents' },
  { key: 'mitigation',     label: 'Mitigation'               },
  { key: 'reconstruction', label: 'Reconstruction'           },
]

const COL_FIELDS = [
  { key: 'Estimate',   label: 'Our Estimate', color: '#0f172a' },
  { key: 'ACV',        label: 'Ins. ACV',     color: '#d97706' },
  { key: 'RCV',        label: 'Ins. RCV',     color: '#7c3aed' },
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
const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

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
    claimNumber:      prefill.claimNumber      || '',
    policyNumber:     prefill.policyNumber     || '',
    dateOfLoss:       prefill.dateOfLoss       || '',
    settlementDate:   '',
    insuranceCompany: prefill.insuranceCompany || '',
    adjusterName:     prefill.adjusterName     || '',
    adjusterPhone:    prefill.adjusterPhone    || '',
    adjusterEmail:    prefill.adjusterEmail    || '',
    status:           'estimating',
    deductible:       '',
    recoupPercent:    100,
    notes:            '',
  }
  for (const cat of CATEGORIES) {
    for (const col of COL_FIELDS) {
      base[`${cat.key}${col.key}`] = ''
    }
  }
  return base
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettlementOverviewCard({ clientUid, clientName, orgId, phone, prefill = {} }) {
  const navigate = useNavigate()
  const prevPrefillRef = useRef(null)

  const [loading,     setLoading]     = useState(true)
  const [settlements, setSettlements] = useState([])
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
    if (clientUid) load()
  }, [clientUid])

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(
        query(collection(db, 'users', clientUid, 'settlements'), orderBy('createdAt', 'desc'))
      )
      setSettlements(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

  async function doSave() {
    if (!clientUid) return
    setSaving(true)
    try {
      const totals = computeTotals(form)
      const data = {
        ...form,
        totalEstimate:  totals.Estimate,
        totalSettled:   totals.Settled,
        recoveryRate:   totals.recoveryRate,
        gap:            totals.gap,
        createdAt:      serverTimestamp(),
        updatedAt:      serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'users', clientUid, 'settlements'), data)
      if (orgId) {
        const rp = n(data.recoupPercent) || 100
        await setDoc(doc(db, 'organization_data', orgId, 'settlement_summary', ref.id), {
          settlementId:           ref.id,
          clientUid,
          clientName:             clientName || '',
          claimNumber:            data.claimNumber            || '',
          insuranceCompany:       data.insuranceCompany       || '',
          status:                 data.status                 || 'estimating',
          dateOfLoss:             data.dateOfLoss             || '',
          settlementDate:         data.settlementDate         || '',
          dryCleanEstimate:       n(data.dryCleanEstimate),
          mitigationEstimate:     n(data.mitigationEstimate),
          reconstructionEstimate: n(data.reconstructionEstimate),
          dryCleanSettled:        n(data.dryCleanSettled),
          mitigationSettled:      n(data.mitigationSettled),
          reconstructionSettled:  n(data.reconstructionSettled),
          totalEstimate:          totals.Estimate,
          totalSettled:           totals.Settled,
          recoveryRate:           totals.recoveryRate,
          gap:                    totals.gap,
          recoupPercent:          rp,
          companyRecoup:          totals.Settled * rp / 100,
          updatedAt:              serverTimestamp(),
        })
      }
      setSettlements(prev => [{ id: ref.id, ...data }, ...prev])
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
                    {(n(s.dryCleanSettled) > 0 || n(s.mitigationSettled) > 0 || n(s.reconstructionSettled) > 0) && (
                      <button className="sovc-receipt-btn" onClick={() => {
                        const items = [
                          n(s.dryCleanSettled)       > 0 && { label: 'Dry Cleaning / Contents', unit: 'total', price: n(s.dryCleanSettled) },
                          n(s.mitigationSettled)     > 0 && { label: 'Mitigation',               unit: 'total', price: n(s.mitigationSettled) },
                          n(s.reconstructionSettled) > 0 && { label: 'Reconstruction',            unit: 'total', price: n(s.reconstructionSettled) },
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
                  {t.Estimate > 0 && (
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

                {t.Estimate > 0 && (
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
              { key: 'claimNumber',      label: 'Claim Number',         placeholder: 'e.g. CLM-2024-00123', type: 'text'   },
              { key: 'policyNumber',     label: 'Policy Number',        placeholder: 'e.g. POL-987654',     type: 'text'   },
              { key: 'dateOfLoss',       label: 'Date of Loss',         placeholder: '',                    type: 'date'   },
              { key: 'settlementDate',   label: 'Settlement Date',      placeholder: '',                    type: 'date'   },
              { key: 'insuranceCompany', label: 'Insurance Company',    placeholder: 'e.g. State Farm',     type: 'text'   },
              { key: 'adjusterName',     label: 'Adjuster Name',        placeholder: 'Full name',           type: 'text'   },
              { key: 'adjusterPhone',    label: 'Adjuster Phone',       placeholder: '(555) 000-0000',      type: 'tel'    },
              { key: 'adjusterEmail',    label: 'Adjuster Email',       placeholder: 'adjuster@insurer.com',type: 'email'  },
              { key: 'deductible',       label: 'Client Deductible ($)',placeholder: '0.00',                type: 'number' },
            ].map(f => (
              <div key={f.key} className="sovc-field">
                <label className="sovc-label">{f.label}</label>
                <input
                  className={`sovc-input${form[f.key] && f.key !== 'deductible' && (
                    f.key === 'claimNumber'      && prefill.claimNumber      ||
                    f.key === 'policyNumber'     && prefill.policyNumber     ||
                    f.key === 'insuranceCompany' && prefill.insuranceCompany ||
                    f.key === 'adjusterName'     && prefill.adjusterName     ||
                    f.key === 'adjusterPhone'    && prefill.adjusterPhone    ||
                    f.key === 'adjusterEmail'    && prefill.adjusterEmail
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

          {/* Profit recoup */}
          <div className="sovc-recoup-block">
            <div className="sovc-recoup-header">
              <label className="sovc-label">Profit Recoup</label>
              <span className="sovc-recoup-pct">{form.recoupPercent ?? 100}%</span>
            </div>
            <input type="range" min="0" max="100" step="5"
              className="sovc-recoup-slider"
              value={form.recoupPercent ?? 100}
              onChange={e => setForm(p => ({ ...p, recoupPercent: Number(e.target.value) }))} />
            <div className="sovc-recoup-labels">
              <span>0% — partner keeps all</span>
              <span>50/50</span>
              <span>100% — we keep all</span>
            </div>
            {(() => {
              const t = computeTotals(form)
              const rp = form.recoupPercent ?? 100
              return t.Settled > 0 ? (
                <p className="sovc-recoup-net">
                  Company net: <strong>{(t.Settled * rp / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong>
                  {rp < 100 && ` · partner: ${(t.Settled * (100 - rp) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`}
                </p>
              ) : null
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

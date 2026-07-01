import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import {
  doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp, orderBy, query
} from 'firebase/firestore'
import { useAuth } from './useAuth'
import './Settlement.css'
import InsurerCombobox from './InsurerCombobox'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'dryClean',       label: 'Dry Cleaning / Contents' },
  { key: 'mitigation',     label: 'Mitigation'               },
  { key: 'reconstruction', label: 'Reconstruction'           },
]

const COL_FIELDS = [
  { key: 'Estimate',    label: 'Our Estimate',      hint: 'Amount on your scope of work',        color: '#0f172a' },
  { key: 'ACV',         label: 'Insurance ACV',     hint: 'Actual Cash Value (depreciated)',     color: '#d97706' },
  { key: 'RCV',         label: 'Insurance RCV',     hint: 'Replacement Cost Value (full)',       color: '#7c3aed' },
  { key: 'Supplement',  label: 'Supplement',        hint: 'Additional amounts negotiated',       color: '#0891b2' },
  { key: 'Settled',     label: 'Final Settlement',  hint: 'Total amount actually paid out',      color: '#16a34a' },
]

const STATUS_META = {
  estimating:    { label: 'Estimating',    color: '#64748b', bg: '#f1f5f9' },
  submitted:     { label: 'Submitted',     color: '#2563eb', bg: '#eff6ff' },
  negotiating:   { label: 'Negotiating',   color: '#d97706', bg: '#fffbeb' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
  settled:       { label: 'Settled ✓',     color: '#15803d', bg: '#dcfce7' },
}

const LOG_TYPES = [
  { value: 'estimate_submitted',  label: 'Estimate Submitted',  icon: '📤', color: '#2563eb' },
  { value: 'insurance_response',  label: 'Insurance Response',  icon: '📨', color: '#d97706' },
  { value: 'supplement_filed',    label: 'Supplement Filed',    icon: '📝', color: '#7c3aed' },
  { value: 'supplement_approved', label: 'Supplement Approved', icon: '✅', color: '#16a34a' },
  { value: 'counter_offer',       label: 'Counter Offer',       icon: '🤝', color: '#0891b2' },
  { value: 'final_settlement',    label: 'Final Settlement',    icon: '🏁', color: '#15803d' },
  { value: 'note',                label: 'Internal Note',       icon: '📌', color: '#64748b' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const n = v => parseFloat(v) || 0

function computeTotals(form) {
  const totals = {}
  for (const col of COL_FIELDS) {
    totals[col.key] = CATEGORIES.reduce((s, cat) => s + n(form[`${cat.key}${col.key}`]), 0)
  }
  totals.gap          = Math.max(0, totals.Estimate - totals.Settled)
  totals.recoveryRate = totals.Estimate > 0 ? totals.Settled / totals.Estimate * 100 : 0
  return totals
}

function fmtMoney(v) {
  const num = parseFloat(v) || 0
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

const EMPTY_FORM = (prefill = {}) => ({
  claimNumber: prefill.claimNumber || '', dateOfLoss: '', settlementDate: '',
  insuranceCompany: prefill.insuranceCompany || '', adjusterName: prefill.adjusterName || '',
  adjusterPhone: prefill.adjusterPhone || '', adjusterEmail: prefill.adjusterEmail || '',
  status: 'estimating', deductible: '',
  recoupPercent: 100,
  dryCleanRecoupPct: '', mitigationRecoupPct: '', reconstructionRecoupPct: '',
  partnerId: '', partnerName: '', partnerFeeType: 'percent', partnerFeeValue: '',
  notes: '',
  ...CATEGORIES.flatMap(c => COL_FIELDS.map(f => [`${c.key}${f.key}`, ''])).reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
})

function computeCategoryRecoups(form) {
  const masterPct = n(form.recoupPercent) || 100
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
  // fixed $ = flat referral; percent = use the per-category breakdown total directly
  return form.partnerFeeType === 'fixed' ? n(form.partnerFeeValue) : companyRecoup
}

function buildSummaryDoc(id, data, totals, clientUid, clientName) {
  const hasSettled = totals.Settled > 0
  const masterPct = n(data.recoupPercent) || 100
  const recoups = computeCategoryRecoups(data)
  const partnerFee = hasSettled ? computePartnerFee(data, recoups.companyRecoup) : 0
  return {
    settlementId:                id,
    clientUid:                   clientUid ?? null,
    clientName:                  clientName || '',
    claimNumber:                 data.claimNumber            || '',
    insuranceCompany:            data.insuranceCompany       || '',
    status:                      data.status                 || 'estimating',
    dateOfLoss:                  data.dateOfLoss             || '',
    settlementDate:              data.settlementDate         || '',
    dryCleanEstimate:            n(data.dryCleanEstimate),
    mitigationEstimate:          n(data.mitigationEstimate),
    reconstructionEstimate:      n(data.reconstructionEstimate),
    dryCleanSettled:             n(data.dryCleanSettled),
    mitigationSettled:           n(data.mitigationSettled),
    reconstructionSettled:       n(data.reconstructionSettled),
    totalEstimate:               totals.Estimate,
    totalSettled:                totals.Settled,
    recoveryRate:                hasSettled ? totals.recoveryRate : null,
    gap:                         hasSettled ? totals.gap          : null,
    recoupPercent:               masterPct,
    dryCleanRecoupPct:           hasSettled ? (recoups.breakdown[0]?.pct ?? null) : null,
    mitigationRecoupPct:         hasSettled ? (recoups.breakdown[1]?.pct ?? null) : null,
    reconstructionRecoupPct:     hasSettled ? (recoups.breakdown[2]?.pct ?? null) : null,
    dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
    mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
    reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
    companyRecoup:               hasSettled ? recoups.companyRecoup : null,
    partnerId:                   data.partnerId   || null,
    partnerName:                 data.partnerName || null,
    partnerFeeType:              data.partnerFeeType  || 'percent',
    partnerFeeValue:             n(data.partnerFeeValue),
    partnerFee:                  hasSettled && data.partnerId ? partnerFee : null,
    companyNetAfterPartner:      hasSettled ? totals.Settled - (data.partnerId ? partnerFee : 0) : null,
    updatedAt:                   serverTimestamp(),
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settlement() {
  const { id: phone } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading,      setLoading]      = useState(true)
  const [clientUid,    setClientUid]    = useState(null)
  const [clientDocId,  setClientDocId]  = useState(null)
  const [clientName,   setClientName]   = useState('')
  const [orgId,        setOrgId]        = useState(null)
  const [claimNumbers, setClaimNumbers] = useState([])
  const [settlements,  setSettlements]  = useState([])
  const [partners,     setPartners]     = useState([])
  const [insurers,     setInsurers]     = useState([])
  const [clientPrefill,setClientPrefill]= useState({})
  const [expanded,     setExpanded]     = useState(null)
  const [editingId,    setEditingId]    = useState(null)
  const [showNew,      setShowNew]      = useState(false)
  const [newForm,      setNewForm]      = useState(EMPTY_FORM())
  const [savingNew,    setSavingNew]    = useState(false)

  useEffect(() => { if (user) load() }, [user, phone])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const partnerSnap = await getDocs(query(collection(db, 'organization_data', oid, 'partners'), orderBy('name', 'asc'))).catch(() => ({ docs: [] }))
      setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      const insurerSnap = await getDocs(query(collection(db, 'organization_data', oid, 'insurers'), orderBy('name', 'asc'))).catch(() => ({ docs: [] }))
      setInsurers(insurerSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      const clientsSnap = await getDocs(collection(db, 'organization_data', oid, 'clients'))
      const clientDoc = clientsSnap.docs.find(d => {
        const p = d.data().phone || ''
        return p === phone || p.replace(/\D/g,'') === phone.replace(/\D/g,'')
      })
      if (!clientDoc) return

      const cdata = clientDoc.data()
      const docId = clientDoc.id
      const uid   = cdata.uid
      setClientUid(uid)
      setClientDocId(docId)

      const orgSettSnap = await getDocs(
        query(collection(db, 'organization_data', oid, 'clients', docId, 'settlements'), orderBy('createdAt', 'desc'))
      ).catch(() => null)
      const orgSetts = orgSettSnap?.docs.map(d => ({ id: d.id, _isOrgSettlement: true, ...d.data() })) || []

      if (uid) {
        const [uSnap, userSettSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          getDocs(query(collection(db, 'users', uid, 'settlements'), orderBy('createdAt', 'desc'))),
        ])
        if (uSnap.exists()) {
          const ud = uSnap.data()
          setClientName(ud.displayName || cdata.name || '')
          setClaimNumbers(ud.claimNumbers || [])
          const adj = ud.adjuster || cdata.adjuster || {}
          const pf = { insuranceCompany: adj.company || '', adjusterName: adj.name || '', adjusterPhone: adj.phone || '', adjusterEmail: adj.email || '' }
          setClientPrefill(pf)
          setNewForm(EMPTY_FORM(pf))
        }
        const userSetts = userSettSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const seenIds   = new Set(userSetts.map(s => s.id))
        const merged    = [...userSetts, ...orgSetts.filter(s => !seenIds.has(s.id))]
        setSettlements(merged)
        if (merged.length > 0) setExpanded(merged[0].id)
      } else {
        setClientName(cdata.name || '')
        setClaimNumbers(cdata.claimNumbers || [])
        const adj = cdata.adjuster || {}
        const pf = { insuranceCompany: adj.company || '', adjusterName: adj.name || '', adjusterPhone: adj.phone || '', adjusterEmail: adj.email || '' }
        setClientPrefill(pf)
        setNewForm(EMPTY_FORM(pf))
        setSettlements(orgSetts)
        if (orgSetts.length > 0) setExpanded(orgSetts[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  async function saveNew() {
    if (!clientUid && !(orgId && clientDocId)) return
    setSavingNew(true)
    try {
      let newFormMut = { ...newForm }
      const totals = computeTotals(newFormMut)
      const hasSettled = totals.Settled > 0
      // Auto-set settlementDate if settled with no date
      if (hasSettled && newFormMut.status === 'settled' && !newFormMut.settlementDate) {
        newFormMut = { ...newFormMut, settlementDate: new Date().toISOString().slice(0, 10) }
      }
      const recoups = computeCategoryRecoups(newFormMut)
      const partnerFee = hasSettled ? computePartnerFee(newFormMut, recoups.companyRecoup) : 0
      const data = {
        ...newFormMut,
        totalEstimate:               totals.Estimate,
        totalSettled:                totals.Settled,
        recoveryRate:                hasSettled ? totals.recoveryRate : null,
        gap:                         hasSettled ? totals.gap          : null,
        companyRecoup:               hasSettled ? recoups.companyRecoup : null,
        dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
        mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
        reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
        partnerFee:                  hasSettled && newFormMut.partnerId ? partnerFee : null,
        companyNetAfterPartner:      hasSettled ? totals.Settled - (newFormMut.partnerId ? partnerFee : 0) : null,
        createdAt:                   serverTimestamp(),
        updatedAt:                   serverTimestamp(),
        createdBy:                   user.uid,
      }
      const settColRef = clientUid
        ? collection(db, 'users', clientUid, 'settlements')
        : collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements')
      const ref = await addDoc(settColRef, data)
      if (orgId) {
        await setDoc(
          doc(db, 'organization_data', orgId, 'settlement_summary', ref.id),
          buildSummaryDoc(ref.id, newFormMut, totals, clientUid, clientName)
        )
      }
      setSettlements(prev => [{ id: ref.id, ...data, ...(!clientUid && { _isOrgSettlement: true }) }, ...prev])
      setShowNew(false)
      setNewForm(EMPTY_FORM(clientPrefill))
      setExpanded(ref.id)
    } finally {
      setSavingNew(false)
    }
  }

  if (loading) return <div className="sl-loading">Loading…</div>

  const backPath = `/myclaim/clients/${encodeURIComponent(phone)}`

  return (
    <div className="sl-root">
      <div className="sl-header">
        <div>
          <button className="sl-back" onClick={() => navigate(backPath)}>← Back to Client</button>
          <h2 className="sl-title">Insurance Settlement Tracker</h2>
          {clientName && <p className="sl-sub">{clientName}</p>}
        </div>
        <button className="sl-btn sl-btn--primary" onClick={() => { setShowNew(true); setExpanded(null) }}>
          + Track New Claim
        </button>
      </div>

      {/* ── New settlement form ── */}
      {showNew && (
        <div className="sl-card sl-card--new">
          <div className="sl-card-title-row">
            <span className="sl-section-label">New Claim</span>
            <button className="sl-ghost-btn" onClick={() => setShowNew(false)}>✕</button>
          </div>
          <SettlementForm
            form={newForm}
            onChange={setNewForm}
            claimNumbers={claimNumbers}
            onSave={saveNew}
            onCancel={() => setShowNew(false)}
            saving={savingNew}
            partners={partners}
            insurers={insurers}
            isNew
          />
        </div>
      )}

      {/* ── Settlement list ── */}
      {settlements.length === 0 && !showNew ? (
        <div className="sl-empty">
          <div className="sl-empty-icon">🏛️</div>
          <p className="sl-empty-title">No settlements tracked yet</p>
          <p className="sl-empty-sub">Start tracking insurance negotiations for this client.</p>
          <button className="sl-btn sl-btn--primary" onClick={() => setShowNew(true)}>
            Track New Claim
          </button>
        </div>
      ) : (
        settlements.map(s => (
          <SettlementRecord
            key={s.id}
            settlement={s}
            clientUid={clientUid}
            clientDocId={clientDocId}
            clientName={clientName}
            orgId={orgId}
            phone={phone}
            userId={user.uid}
            userEmail={user.email}
            partners={partners}
            insurers={insurers}
            expanded={expanded === s.id}
            editing={editingId === s.id}
            onToggle={() => { setExpanded(prev => prev === s.id ? null : s.id); setEditingId(null) }}
            onEdit={() => { setEditingId(s.id); setExpanded(s.id) }}
            onCancelEdit={() => setEditingId(null)}
            onSaved={updated => {
              setSettlements(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))
              setEditingId(null)
            }}
            onDelete={() => setSettlements(prev => prev.filter(x => x.id !== s.id))}
          />
        ))
      )}
    </div>
  )
}

// ── Settlement record (summary + expandable detail) ───────────────────────────

function SettlementRecord({ settlement: s, clientUid, clientDocId, clientName, orgId, phone, userId, userEmail, partners, insurers, expanded, editing, onToggle, onEdit, onCancelEdit, onSaved, onDelete }) {
  const navigate = useNavigate()
  const totals = computeTotals(s)
  const sm = STATUS_META[s.status] || STATUS_META.estimating
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [log, setLog]           = useState(null)
  const [loadingLog, setLoadingLog] = useState(false)
  const [showLogForm, setShowLogForm] = useState(false)
  const [confirmDel, setConfirmDel]  = useState(false)
  const [deleting, setDeleting]      = useState(false)

  useEffect(() => {
    if (editing) {
      setEditForm({ ...s })
      setSaveError(null)
    } else {
      setEditForm(null)
    }
  }, [editing])

  useEffect(() => {
    if (expanded && !log) loadLog()
  }, [expanded])

  async function loadLog() {
    setLoadingLog(true)
    try {
      const logColl = (s._isOrgSettlement || !clientUid)
        ? collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', s.id, 'log')
        : collection(db, 'users', clientUid, 'settlements', s.id, 'log')
      const snap = await getDocs(query(logColl, orderBy('date', 'asc')))
      setLog(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoadingLog(false)
    }
  }

  async function doSave() {
    if (!editForm) return
    setSaving(true)
    setSaveError(null)
    try {
      const totals = computeTotals(editForm)
      const { id: _id, _isOrgSettlement: _flag, ...cleanForm } = editForm
      const hasSettled = totals.Settled > 0
      const recoups = computeCategoryRecoups(editForm)
      const partnerFee = hasSettled ? computePartnerFee(editForm, recoups.companyRecoup) : 0
      const updates = {
        ...cleanForm,
        totalEstimate:               totals.Estimate,
        totalSettled:                totals.Settled,
        recoveryRate:                hasSettled ? totals.recoveryRate : null,
        gap:                         hasSettled ? totals.gap          : null,
        companyRecoup:               hasSettled ? recoups.companyRecoup : null,
        dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
        mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
        reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
        partnerFee:                  hasSettled && editForm.partnerId ? partnerFee : null,
        companyNetAfterPartner:      hasSettled ? totals.Settled - (editForm.partnerId ? partnerFee : 0) : null,
        settlementDate:              editForm.settlementDate || (hasSettled && editForm.status === 'settled' ? new Date().toISOString().slice(0, 10) : ''),
        updatedAt:                   serverTimestamp(),
      }
      // Use setDoc+merge so edits succeed even if the doc path differs from what the flag implies
      const settDocRef = (s._isOrgSettlement || !clientUid)
        ? doc(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', s.id)
        : doc(db, 'users', clientUid, 'settlements', s.id)
      await setDoc(settDocRef, updates, { merge: true })
      if (orgId) {
        setDoc(
          doc(db, 'organization_data', orgId, 'settlement_summary', s.id),
          buildSummaryDoc(s.id, updates, totals, clientUid, clientName)
        ).catch(e => console.warn('settlement_summary update:', e))
      }
      onSaved(updates)
    } catch (e) {
      console.error('Settlement save failed:', e)
      setSaveError('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    try {
      const settDocRef = (s._isOrgSettlement || !clientUid)
        ? doc(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', s.id)
        : doc(db, 'users', clientUid, 'settlements', s.id)
      await deleteDoc(settDocRef)
      if (orgId) {
        await deleteDoc(doc(db, 'organization_data', orgId, 'settlement_summary', s.id))
      }
      onDelete()
    } finally {
      setDeleting(false); setConfirmDel(false)
    }
  }

  const displayTotals = editing && editForm ? computeTotals(editForm) : totals
  const recovPct = Math.min(100, displayTotals.recoveryRate)

  return (
    <div className={`sl-card${expanded ? ' sl-card--expanded' : ''}`}>
      {/* ── Summary row ── */}
      <div className="sl-summary-row" onClick={onToggle}>
        <div className="sl-summary-left">
          <span className="sl-claim-num">{s.claimNumber || 'No claim #'}</span>
          <span className="sl-insurer">{s.insuranceCompany || 'Insurance TBD'}</span>
          <span className="sl-loss-date">{s.dateOfLoss ? `Loss: ${fmtDate(s.dateOfLoss)}` : ''}</span>
        </div>
        <div className="sl-summary-metrics">
          <div className="sl-metric">
            <span className="sl-metric-label">Estimated</span>
            <span className="sl-metric-val">{fmtMoney(displayTotals.Estimate)}</span>
          </div>
          <div className="sl-metric">
            <span className="sl-metric-label">Settled</span>
            <span className="sl-metric-val" style={{ color: '#16a34a' }}>{fmtMoney(displayTotals.Settled)}</span>
          </div>
          <div className="sl-metric">
            <span className="sl-metric-label">Gap</span>
            <span className="sl-metric-val" style={{ color: displayTotals.gap > 0 ? '#dc2626' : '#94a3b8' }}>
              {displayTotals.gap > 0 ? `– ${fmtMoney(displayTotals.gap)}` : '—'}
            </span>
          </div>
          <div className="sl-metric">
            <span className="sl-metric-label">Recovery</span>
            <span className="sl-metric-val" style={{
              color: displayTotals.recoveryRate >= 90 ? '#15803d' : displayTotals.recoveryRate >= 75 ? '#d97706' : displayTotals.recoveryRate > 0 ? '#dc2626' : '#94a3b8'
            }}>
              {displayTotals.Settled > 0 ? `${displayTotals.recoveryRate.toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>
        <div className="sl-summary-right">
          <span className="sl-badge" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
          <span className="sl-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Recovery bar (visible when not editing) ── */}
      {!editing && displayTotals.Settled > 0 && (
        <div className="sl-recovery-bar-wrap">
          <div className="sl-recovery-bar">
            <div className="sl-recovery-fill sl-recovery-fill--settled"
              style={{ width: `${Math.min(100, displayTotals.Settled / displayTotals.Estimate * 100)}%` }} />
            {displayTotals.ACV > 0 && (
              <div className="sl-recovery-fill sl-recovery-fill--acv"
                style={{ width: `${Math.min(100, displayTotals.ACV / displayTotals.Estimate * 100)}%` }} />
            )}
          </div>
          <span className="sl-recovery-pct">{recovPct.toFixed(1)}% recovered</span>
        </div>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="sl-detail">
          {editing && editForm ? (
            <>
              <SettlementForm
                form={editForm}
                onChange={setEditForm}
                claimNumbers={[]}
                onSave={doSave}
                onCancel={onCancelEdit}
                saving={saving}
                saveError={saveError}
                partners={partners || []}
                insurers={insurers || []}
              />
            </>
          ) : (
            <>
              {/* Adjuster info */}
              {(s.adjusterName || s.insuranceCompany || s.adjusterEmail) && (
                <div className="sl-adjuster-row">
                  {s.adjusterName    && <span>👤 {s.adjusterName}</span>}
                  {s.adjusterPhone   && <span>📞 {s.adjusterPhone}</span>}
                  {s.adjusterEmail   && <span>✉️ {s.adjusterEmail}</span>}
                  {s.deductible > 0  && <span>🧾 Deductible: {fmtMoney(s.deductible)}</span>}
                </div>
              )}

              {/* Category breakdown table */}
              <div className="sl-table-wrap">
                <table className="sl-table">
                  <thead>
                    <tr>
                      <th className="sl-th-cat">Category</th>
                      {COL_FIELDS.map(f => (
                        <th key={f.key} className="sl-th-num" style={{ color: f.color }} title={f.hint}>{f.label}</th>
                      ))}
                      <th className="sl-th-num sl-gap-col">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => {
                      const gap = Math.max(0, n(s[`${cat.key}Estimate`]) - n(s[`${cat.key}Settled`]))
                      return (
                        <tr key={cat.key} className="sl-data-row">
                          <td className="sl-td-cat">{cat.label}</td>
                          {COL_FIELDS.map(f => {
                            const val = n(s[`${cat.key}${f.key}`])
                            return (
                              <td key={f.key} className="sl-td-num">
                                {val > 0 ? <span style={{ color: f.color }}>{fmtMoney(val)}</span> : <span className="sl-dash">—</span>}
                              </td>
                            )
                          })}
                          <td className="sl-td-num sl-gap-col">
                            {gap > 0 ? <span className="sl-gap-amt">– {fmtMoney(gap)}</span> : <span className="sl-dash">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="sl-total-row">
                      <td>Total</td>
                      {COL_FIELDS.map(f => (
                        <td key={f.key} className="sl-td-num">
                          <strong style={{ color: f.color }}>{fmtMoney(displayTotals[f.key])}</strong>
                        </td>
                      ))}
                      <td className="sl-td-num sl-gap-col">
                        {displayTotals.gap > 0
                          ? <strong className="sl-gap-amt">– {fmtMoney(displayTotals.gap)}</strong>
                          : <span className="sl-dash">—</span>}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Recovery analysis */}
              {displayTotals.Estimate > 0 && (
                <div className="sl-analysis">
                  <RecoveryBar label="Our Estimate"     value={displayTotals.Estimate} max={displayTotals.Estimate} color="#e2e8f0" />
                  {displayTotals.RCV > 0 && (
                    <RecoveryBar label="Insurance RCV"    value={displayTotals.RCV}      max={displayTotals.Estimate} color="#c4b5fd" />
                  )}
                  {displayTotals.ACV > 0 && (
                    <RecoveryBar label="Insurance ACV"    value={displayTotals.ACV}      max={displayTotals.Estimate} color="#fde68a" />
                  )}
                  {displayTotals.Settled > 0 && (
                    <RecoveryBar label="Final Settlement" value={displayTotals.Settled}   max={displayTotals.Estimate} color="#86efac" highlight />
                  )}
                  {n(s.deductible) > 0 && (
                    <div className="sl-deductible-note">
                      Client deductible: {fmtMoney(s.deductible)} — net to company: {fmtMoney(Math.max(0, displayTotals.Settled - n(s.deductible)))}
                    </div>
                  )}
                </div>
              )}

              {s.notes && <div className="sl-notes">📝 {s.notes}</div>}

              <div className="sl-detail-actions">
                <button className="sl-btn sl-btn--outline" onClick={onEdit}>Edit</button>
                <button className="sl-btn sl-btn--receipt" onClick={() => {
                  const items = [
                    n(s.dryCleanSettled)        > 0 && { label: 'Dry Cleaning / Contents', unit: 'total', price: n(s.dryCleanSettled) },
                    n(s.mitigationSettled)      > 0 && { label: 'Mitigation',               unit: 'total', price: n(s.mitigationSettled) },
                    n(s.reconstructionSettled)  > 0 && { label: 'Reconstruction',            unit: 'total', price: n(s.reconstructionSettled) },
                  ].filter(Boolean)
                  navigate(
                    `/myclaim/clients/${encodeURIComponent(phone)}/invoices/new`,
                    { state: {
                      prefillType:  'receipt',
                      prefillNotes: `Insurance settlement receipt — Claim ${s.claimNumber || ''}${s.insuranceCompany ? ` (${s.insuranceCompany})` : ''}`,
                      prefillItems: items,
                    }}
                  )
                }}>
                  🧾 Generate Receipt
                </button>
                <button className="sl-btn sl-btn--danger-outline" onClick={() => setConfirmDel(true)}>Delete</button>
              </div>
            </>
          )}

          {/* ── Negotiation log ── */}
          <div className="sl-log-section">
            <div className="sl-log-header">
              <span className="sl-section-label">Negotiation Log</span>
              <button className="sl-btn sl-btn--sm" onClick={() => setShowLogForm(v => !v)}>
                {showLogForm ? 'Cancel' : '+ Add Entry'}
              </button>
            </div>

            {showLogForm && (
              <LogEntryForm
                clientUid={clientUid}
                orgId={orgId}
                clientDocId={clientDocId}
                isOrgSettlement={s._isOrgSettlement || !clientUid}
                settlementId={s.id}
                userEmail={userEmail}
                onAdded={entry => {
                  setLog(prev => [...(prev || []), entry].sort((a, b) => a.date > b.date ? 1 : -1))
                  setShowLogForm(false)
                }}
              />
            )}

            {loadingLog ? (
              <div className="sl-log-loading">Loading log…</div>
            ) : log?.length > 0 ? (
              <div className="sl-timeline">
                {log.map((entry, i) => {
                  const lt = LOG_TYPES.find(t => t.value === entry.type) || LOG_TYPES[LOG_TYPES.length - 1]
                  return (
                    <div key={entry.id} className="sl-timeline-item">
                      <div className="sl-timeline-dot" style={{ background: lt.color }}>{lt.icon}</div>
                      <div className="sl-timeline-line" style={{ opacity: i < log.length - 1 ? 1 : 0 }} />
                      <div className="sl-timeline-body">
                        <div className="sl-timeline-header">
                          <span className="sl-timeline-type" style={{ color: lt.color }}>{lt.label}</span>
                          <span className="sl-timeline-date">{fmtDate(entry.date)}</span>
                          {entry.amount > 0 && <span className="sl-timeline-amt">{fmtMoney(entry.amount)}</span>}
                        </div>
                        {entry.description && <p className="sl-timeline-desc">{entry.description}</p>}
                        {entry.category && entry.category !== 'all' && (
                          <span className="sl-timeline-cat">
                            {CATEGORIES.find(c => c.key === entry.category)?.label || entry.category}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="sl-log-empty">No log entries yet. Add your first entry to start tracking negotiations.</p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="sl-overlay" onClick={() => setConfirmDel(false)}>
          <div className="sl-modal" onClick={e => e.stopPropagation()}>
            <p className="sl-modal-title">Delete this settlement record?</p>
            <p className="sl-modal-body">{s.claimNumber || 'This claim'} and all its log entries will be permanently removed.</p>
            <div className="sl-modal-actions">
              <button className="sl-btn sl-btn--outline" onClick={() => setConfirmDel(false)}>Cancel</button>
              <button className="sl-btn sl-btn--danger" onClick={doDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Settlement form (new + edit) ──────────────────────────────────────────────

function SettlementForm({ form, onChange, claimNumbers, onSave, onCancel, saving, saveError, isNew, partners = [], insurers = [] }) {
  const set = (k, v) => onChange(prev => ({ ...prev, [k]: v }))

  return (
    <div className="sl-form">
      {/* Header fields */}
      <div className="sl-form-grid">
        <div className="sl-field">
          <label className="sl-label">Claim Number</label>
          <input className="sl-input" value={form.claimNumber}
            onChange={e => set('claimNumber', e.target.value)}
            placeholder={claimNumbers[0] || 'e.g. ABC-123456'} />
        </div>
        <div className="sl-field">
          <label className="sl-label">Date of Loss</label>
          <input className="sl-input" type="date" value={form.dateOfLoss}
            onChange={e => set('dateOfLoss', e.target.value)} />
        </div>
        <div className="sl-field">
          <label className="sl-label">Settlement Date</label>
          <input className="sl-input" type="date" value={form.settlementDate || ''}
            onChange={e => set('settlementDate', e.target.value)} />
        </div>
        <div className="sl-field">
          <label className="sl-label">Insurance Company</label>
          <InsurerCombobox
            className="sl-input"
            value={form.insuranceCompany || ''}
            onChange={v => set('insuranceCompany', v)}
            insurers={insurers}
          />
        </div>
        <div className="sl-field">
          <label className="sl-label">Status</label>
          <select className="sl-input" value={form.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(STATUS_META).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="sl-field">
          <label className="sl-label">Adjuster Name</label>
          <input className="sl-input" value={form.adjusterName}
            onChange={e => set('adjusterName', e.target.value)} placeholder="Full name" />
        </div>
        <div className="sl-field">
          <label className="sl-label">Adjuster Phone</label>
          <input className="sl-input" type="tel" value={form.adjusterPhone}
            onChange={e => set('adjusterPhone', e.target.value)} placeholder="(555) 000-0000" />
        </div>
        <div className="sl-field">
          <label className="sl-label">Adjuster Email</label>
          <input className="sl-input" type="email" value={form.adjusterEmail}
            onChange={e => set('adjusterEmail', e.target.value)} placeholder="adjuster@insurer.com" />
        </div>
        <div className="sl-field">
          <label className="sl-label">Client Deductible ($)</label>
          <input className="sl-input" type="number" min="0" step="0.01" value={form.deductible}
            onChange={e => set('deductible', e.target.value)} placeholder="0.00" />
        </div>
      </div>

      {/* Category amounts table */}
      <div className="sl-form-table-label">Claim Amounts by Category</div>
      <div className="sl-form-table-wrap">
        <table className="sl-form-table">
          <thead>
            <tr>
              <th>Category</th>
              {COL_FIELDS.map(f => (
                <th key={f.key} title={f.hint} style={{ color: f.color }}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(cat => (
              <tr key={cat.key}>
                <td className="sl-form-cat-label">{cat.label}</td>
                {COL_FIELDS.map(f => (
                  <td key={f.key}>
                    <input
                      className="sl-amount-input"
                      type="number" min="0" step="0.01"
                      placeholder="—"
                      value={form[`${cat.key}${f.key}`]}
                      onChange={e => set(`${cat.key}${f.key}`, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sl-form-totals">
              <td>Totals</td>
              {COL_FIELDS.map(f => {
                const tot = CATEGORIES.reduce((s, c) => s + n(form[`${c.key}${f.key}`]), 0)
                return (
                  <td key={f.key} className="sl-form-total-cell" style={{ color: f.color }}>
                    {tot > 0 ? fmtMoney(tot) : '—'}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Referral Fee Breakdown - per category */}
      <div className="sl-recoup-block">
        <div className="sl-recoup-section-title">Referral Fee Breakdown</div>

        {/* Master slider */}
        <div className="sl-recoup-master-row">
          <div className="sl-recoup-header">
            <label className="sl-label">Default Referral Fee %</label>
            <span className="sl-recoup-pct">{n(form.recoupPercent) || 0}%</span>
          </div>
          <input type="range" min="0" max="100" step="5"
            className="sl-recoup-slider"
            value={n(form.recoupPercent) || 0}
            onChange={e => set('recoupPercent', Number(e.target.value))} />
          <div className="sl-recoup-labels">
            <span>0% — no referral fee</span>
            <span>50% of settled</span>
            <span>100% — all settled to partner</span>
          </div>
        </div>

        {/* Per-category overrides */}
        <div className="sl-recoup-cats">
          <div className="sl-recoup-cats-label">Per-Category Override (blank = use default)</div>
          {CATEGORIES.map(cat => {
            const fieldKey = `${cat.key}RecoupPct`
            const val = form[fieldKey]
            const masterPct = n(form.recoupPercent) || 100
            const effectivePct = (val !== null && val !== undefined && val !== '') ? n(val) : masterPct
            const settled = n(form[`${cat.key}Settled`])
            const recoup = settled * effectivePct / 100
            return (
              <div key={cat.key} className="sl-recoup-cat-row">
                <span className="sl-recoup-cat-name">{cat.label}</span>
                <div className="sl-recoup-cat-input-wrap">
                  <input
                    type="number" min="0" max="100" step="1"
                    className="sl-amount-input sl-recoup-cat-input"
                    placeholder={`${masterPct}% (master)`}
                    value={val ?? ''}
                    onChange={e => set(fieldKey, e.target.value)}
                  />
                  <span className="sl-recoup-cat-unit">%</span>
                </div>
                {settled > 0 && (
                  <span className="sl-recoup-cat-preview">
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
            <div className="sl-recoup-total-preview">
              <span>Referral fee paid to partner: <strong>{fmtMoney(companyRecoup)}</strong></span>
              <span className="sl-recoup-split-note">
                (of {fmtMoney(t.Settled)} settled)
              </span>
            </div>
          )
        })()}
      </div>

      {/* Partner / Referral */}
      <div className="sl-partner-block">
        <div className="sl-recoup-section-title">Partner / Referral Fee</div>
        <div className="sl-partner-grid">
          <div className="sl-field">
            <label className="sl-label">Who brought this job?</label>
            <select className="sl-input" value={form.partnerId || ''} onChange={e => {
              const pid = e.target.value
              const pname = partners.find(p => p.id === pid)?.name || ''
              set('partnerId', pid)
              set('partnerName', pname)
            }}>
              <option value="">No partner</option>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {form.partnerId && (
            <>
              <div className="sl-field">
                <label className="sl-label">Fee Type</label>
                <div className="sl-toggle-row">
                  <button type="button"
                    className={`sl-toggle-btn${(form.partnerFeeType || 'percent') === 'percent' ? ' sl-toggle-btn--active' : ''}`}
                    onClick={() => set('partnerFeeType', 'percent')}>% Breakdown Above</button>
                  <button type="button"
                    className={`sl-toggle-btn${form.partnerFeeType === 'fixed' ? ' sl-toggle-btn--active' : ''}`}
                    onClick={() => set('partnerFeeType', 'fixed')}>Fixed $</button>
                </div>
              </div>
              {form.partnerFeeType === 'fixed' && (
                <div className="sl-field">
                  <label className="sl-label">Fixed Referral Fee ($)</label>
                  <input className="sl-input" type="number" min="0" step="1"
                    placeholder="0"
                    value={form.partnerFeeValue || ''}
                    onChange={e => set('partnerFeeValue', e.target.value)} />
                </div>
              )}
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
            <div className="sl-partner-preview">
              <span>{partners.find(p => p.id === form.partnerId)?.name || 'Partner'} earns: <strong>{fmtMoney(fee)}</strong></span>
              <span className="sl-partner-net">Company nets: <strong style={{ color: '#2563eb' }}>{fmtMoney(t.Settled - fee)}</strong></span>
            </div>
          )
        })()}
      </div>

      {/* Notes */}
      <div className="sl-field" style={{ marginTop: 14 }}>
        <label className="sl-label">Notes</label>
        <textarea className="sl-textarea" rows={2} value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Internal notes about this claim…" />
      </div>

      {saveError && <p className="sl-save-error">{saveError}</p>}
      <div className="sl-form-actions">
        <button className="sl-btn sl-btn--outline" onClick={onCancel} type="button">Cancel</button>
        <button className="sl-btn sl-btn--primary" onClick={onSave} disabled={saving} type="button">
          {saving ? 'Saving…' : isNew ? 'Create Settlement' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Log entry form ────────────────────────────────────────────────────────────

function LogEntryForm({ clientUid, orgId, clientDocId, isOrgSettlement, settlementId, userEmail, onAdded }) {
  const [type,        setType]        = useState('insurance_response')
  const [date,        setDate]        = useState(todayStr())
  const [description, setDescription] = useState('')
  const [amount,      setAmount]      = useState('')
  const [category,    setCategory]    = useState('all')
  const [saving,      setSaving]      = useState(false)

  async function doAdd() {
    setSaving(true)
    try {
      const entry = {
        type, date,
        description: description.trim(),
        amount: parseFloat(amount) || 0,
        category,
        createdAt: serverTimestamp(),
        createdBy: userEmail,
      }
      const logColl = isOrgSettlement
        ? collection(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', settlementId, 'log')
        : collection(db, 'users', clientUid, 'settlements', settlementId, 'log')
      const ref = await addDoc(logColl, entry)
      onAdded({ id: ref.id, ...entry })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sl-log-form">
      <div className="sl-log-form-row">
        <div className="sl-field">
          <label className="sl-label">Type</label>
          <select className="sl-input" value={type} onChange={e => setType(e.target.value)}>
            {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
        </div>
        <div className="sl-field">
          <label className="sl-label">Date</label>
          <input className="sl-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="sl-field">
          <label className="sl-label">Amount ($)</label>
          <input className="sl-input" type="number" min="0" step="0.01"
            placeholder="Optional" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="sl-field">
          <label className="sl-label">Category</label>
          <select className="sl-input" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="sl-field" style={{ marginTop: 10 }}>
        <label className="sl-label">Description</label>
        <input className="sl-input" value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. Adjuster rejected mold remediation line item — resubmitting with photos" />
      </div>
      <div className="sl-log-form-actions">
        <button className="sl-btn sl-btn--primary" onClick={doAdd} disabled={saving || !description.trim()}>
          {saving ? 'Adding…' : 'Add to Log'}
        </button>
      </div>
    </div>
  )
}

// ── Recovery bar ──────────────────────────────────────────────────────────────

function RecoveryBar({ label, value, max, color, highlight }) {
  const pct = max > 0 ? Math.min(100, value / max * 100) : 0
  return (
    <div className="sl-rec-row">
      <div className="sl-rec-label">{label}</div>
      <div className="sl-rec-track">
        <div className="sl-rec-fill" style={{ width: `${pct}%`, background: color, boxShadow: highlight ? '0 0 0 1px #16a34a44' : 'none' }} />
      </div>
      <div className="sl-rec-val" style={{ fontWeight: highlight ? 700 : 400, color: highlight ? '#15803d' : '#374151' }}>
        {fmtMoney(value)} <span className="sl-rec-pct">({pct.toFixed(1)}%)</span>
      </div>
    </div>
  )
}

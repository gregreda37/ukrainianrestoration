import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import {
  doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp, orderBy, query
} from 'firebase/firestore'
import { useAuth } from './useAuth'
import './Settlement.css'
import InsurerCombobox from './InsurerCombobox'
import PartnerCombobox from './PartnerCombobox'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'dryClean',       label: 'Dry Cleaning / Contents' },
  { key: 'mitigation',     label: 'Mitigation'               },
  { key: 'reconstruction', label: 'Reconstruction'           },
  { key: 'packout',        label: 'Packout'                  },
]

const COL_FIELDS = [
  { key: 'Estimate',  label: 'Our Estimate',    hint: 'Amount on your scope of work',        color: '#0f172a' },
  { key: 'Settled',   label: 'Final Settlement', hint: 'Total amount actually paid out',     color: '#16a34a' },
  { key: 'Expenses',  label: 'Expenses',         hint: 'Company expenses for this category', color: '#dc2626' },
]

const STATUS_META = {
  estimating:     { label: 'Estimating',     color: '#64748b', bg: '#f1f5f9' },
  submitted:      { label: 'Submitted',      color: '#2563eb', bg: '#eff6ff' },
  negotiating:    { label: 'Negotiating',    color: '#d97706', bg: '#fffbeb' },
  reconstruction: { label: 'Reconstruction', color: '#0891b2', bg: '#ecfeff' },
  settled:        { label: 'Settled ✓',      color: '#15803d', bg: '#dcfce7' },
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
  totals.gap          = totals.Estimate - totals.Settled   // negative = surplus (recovered more than estimated)
  totals.recoveryRate = totals.Estimate > 0 ? totals.Settled / totals.Estimate * 100 : 0
  totals.grossProfit  = totals.Settled - totals.Expenses
  return totals
}

function fmtMoney(v) {
  const num = parseFloat(v) || 0
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  status: 'estimating',
  recoupPercent: 0,
  dryCleanRecoupPct: '', mitigationRecoupPct: '', reconstructionRecoupPct: 0, packoutRecoupPct: '',
  partnerId: '', partnerName: '', partnerFeeType: 'percent', partnerFixedFee: '', partnerFeeOnNet: true,
  notes: '',
  ...CATEGORIES.flatMap(c => COL_FIELDS.map(f => [`${c.key}${f.key}`, ''])).reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
})

function computeCategoryRecoups(form, onNet = false) {
  const masterPct = n(form.recoupPercent)
  let companyRecoup = 0
  const breakdown = CATEGORIES.map(cat => {
    const settled  = n(form[`${cat.key}Settled`])
    const expenses = onNet ? n(form[`${cat.key}Expenses`]) : 0
    const base     = Math.max(0, settled - expenses)
    const override = form[`${cat.key}RecoupPct`]
    const pct = (override !== null && override !== undefined && override !== '') ? n(override) : masterPct
    const recoup = base * pct / 100
    companyRecoup += recoup
    return { key: cat.key, label: cat.label, settled, pct, recoup }
  })
  return { breakdown, companyRecoup }
}

function computePartnerFee(form, companyRecoup) {
  if (!form.partnerId) return 0
  if (form.partnerFeeType === 'fixed') return parseFloat(form.partnerFixedFee) || 0
  return companyRecoup
}

function buildSummaryDoc(id, data, totals, clientUid, clientName, clientPhone, clientDocId) {
  const hasSettled = totals.Settled > 0
  const masterPct = n(data.recoupPercent)
  const recoups = computeCategoryRecoups(data, !!data.partnerFeeOnNet)
  const partnerFee = hasSettled ? computePartnerFee(data, recoups.companyRecoup) : 0
  const totalExpenses = totals.Expenses || 0
  const grossProfit = hasSettled ? totals.Settled - totalExpenses : null
  const netAfterPartner = hasSettled ? totals.Settled - totalExpenses - (data.partnerId ? partnerFee : 0) : null
  return {
    settlementId:                id,
    clientUid:                   clientUid ?? null,
    clientDocId:                 clientDocId ?? null,
    clientPhone:                 clientPhone || null,
    clientName:                  clientName || '',
    claimNumber:                 data.claimNumber            || '',
    insuranceCompany:            data.insuranceCompany       || '',
    status:                      data.status                 || 'estimating',
    dateOfLoss:                  data.dateOfLoss             || '',
    settlementDate:              data.settlementDate         || '',
    dryCleanEstimate:            n(data.dryCleanEstimate),
    mitigationEstimate:          n(data.mitigationEstimate),
    reconstructionEstimate:      n(data.reconstructionEstimate),
    packoutEstimate:             n(data.packoutEstimate),
    dryCleanSettled:             n(data.dryCleanSettled),
    mitigationSettled:           n(data.mitigationSettled),
    reconstructionSettled:       n(data.reconstructionSettled),
    packoutSettled:              n(data.packoutSettled),
    dryCleanExpenses:            n(data.dryCleanExpenses),
    mitigationExpenses:          n(data.mitigationExpenses),
    reconstructionExpenses:      n(data.reconstructionExpenses),
    packoutExpenses:             n(data.packoutExpenses),
    dryCleanPaid:                !!data.dryCleanPaid,
    mitigationPaid:              !!data.mitigationPaid,
    reconstructionPaid:          !!data.reconstructionPaid,
    packoutPaid:                 !!data.packoutPaid,
    dryCleanPaidAmount:          n(data.dryCleanPaidAmount),
    mitigationPaidAmount:        n(data.mitigationPaidAmount),
    reconstructionPaidAmount:    n(data.reconstructionPaidAmount),
    packoutPaidAmount:           n(data.packoutPaidAmount),
    totalPaidAmount:             n(data.totalPaidAmount),
    totalOutstanding:            Math.max(0, totals.Settled - n(data.totalPaidAmount)),
    totalEstimate:               totals.Estimate,
    totalSettled:                totals.Settled,
    totalExpenses:               totalExpenses,
    grossProfit:                 grossProfit,
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
    partnerId:                   data.partnerId      || null,
    partnerName:                 data.partnerName    || null,
    partnerFeeType:              data.partnerFeeType || 'percent',
    partnerFixedFee:             data.partnerFeeType === 'fixed' ? (parseFloat(data.partnerFixedFee) || null) : null,
    partnerFeeOnNet:             !!data.partnerFeeOnNet,
    partnerFee:                  hasSettled && data.partnerId ? partnerFee : null,
    companyNetAfterPartner:      netAfterPartner,
    paid:                        !!data.paid,
    paidDate:                    data.paidDate || null,
    updatedAt:                   serverTimestamp(),
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settlement({ onClose, clientIdOverride } = {}) {
  const params = useParams()
  const routeParam = clientIdOverride || params?.id || ''
  const isPhoneParam = routeParam.startsWith('+')
  const navigate = useNavigate()
  const isModal = !!onClose
  const { user } = useAuth()
  const [clientPhone,  setClientPhone]  = useState('')

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
  const activeSaveRef = useRef(null)

  function handleClose() {
    if (editingId) {
      if (!window.confirm('Close without saving?')) return
    }
    onClose()
  }

  useEffect(() => { if (user) load() }, [user, routeParam])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const [partnerSnap, insurerSnap] = await Promise.all([
        getDocs(query(collection(db, 'organization_data', oid, 'partners'), orderBy('name', 'asc'))).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'organization_data', oid, 'insurers'), orderBy('name', 'asc'))).catch(() => ({ docs: [] })),
      ])
      setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setInsurers(insurerSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      let clientDoc
      if (isPhoneParam) {
        const clientsSnap = await getDocs(collection(db, 'organization_data', oid, 'clients'))
        clientDoc = clientsSnap.docs.find(d => {
          const p = d.data().phone || ''
          return p === routeParam || p.replace(/\D/g,'') === routeParam.replace(/\D/g,'')
        })
      } else {
        const snap = await getDoc(doc(db, 'organization_data', oid, 'clients', routeParam))
        if (snap.exists()) clientDoc = snap
      }
      if (!clientDoc) return

      const cdata = clientDoc.data()
      const docId = clientDoc.id
      const uid   = cdata.uid
      setClientUid(uid)
      setClientDocId(docId)
      setClientPhone(cdata.phone || '')

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
        if (merged.length > 0) {
          const tsMillis = s => (s.updatedAt?.toMillis?.() ?? s.createdAt?.toMillis?.() ?? 0)
          const latest = merged.reduce((a, b) => tsMillis(a) >= tsMillis(b) ? a : b)
          setExpanded(latest.id)
          setEditingId(latest.id)
        }
      } else {
        setClientName(cdata.name || '')
        setClaimNumbers(cdata.claimNumbers || [])
        const adj = cdata.adjuster || {}
        const pf = { insuranceCompany: adj.company || '', adjusterName: adj.name || '', adjusterPhone: adj.phone || '', adjusterEmail: adj.email || '' }
        setClientPrefill(pf)
        setNewForm(EMPTY_FORM(pf))
        setSettlements(orgSetts)
        if (orgSetts.length > 0) {
          const tsMillis = s => (s.updatedAt?.toMillis?.() ?? s.createdAt?.toMillis?.() ?? 0)
          const latest = orgSetts.reduce((a, b) => tsMillis(a) >= tsMillis(b) ? a : b)
          setExpanded(latest.id)
          setEditingId(latest.id)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  async function addPartner(name) {
    const pref = await addDoc(collection(db, 'organization_data', orgId, 'partners'), { name, createdAt: serverTimestamp() })
    const created = { id: pref.id, name }
    setPartners(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
  }
  async function removePartner(partner) {
    await deleteDoc(doc(db, 'organization_data', orgId, 'partners', partner.id))
    setPartners(prev => prev.filter(p => p.id !== partner.id))
  }
  async function addInsurer(name) {
    const iref = await addDoc(collection(db, 'organization_data', orgId, 'insurers'), { name, createdAt: serverTimestamp() })
    setInsurers(prev => [...prev, { id: iref.id, name }].sort((a, b) => a.name.localeCompare(b.name)))
  }
  async function removeInsurer(insurer) {
    await deleteDoc(doc(db, 'organization_data', orgId, 'insurers', insurer.id))
    setInsurers(prev => prev.filter(i => i.id !== insurer.id))
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
      const recoups = computeCategoryRecoups(newFormMut, !!newFormMut.partnerFeeOnNet)
      const partnerFee = hasSettled ? computePartnerFee(newFormMut, recoups.companyRecoup) : 0
      const data = {
        ...newFormMut,
        totalEstimate:               totals.Estimate,
        totalSettled:                totals.Settled,
        totalExpenses:               totals.Expenses,
        recoveryRate:                hasSettled ? totals.recoveryRate : null,
        gap:                         hasSettled ? totals.gap          : null,
        grossProfit:                 hasSettled ? totals.grossProfit  : null,
        companyRecoup:               hasSettled ? recoups.companyRecoup : null,
        dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
        mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
        reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
        packoutCompanyRecoup:        hasSettled ? recoups.breakdown[3]?.recoup : null,
        partnerFee:                  hasSettled && newFormMut.partnerId ? partnerFee : null,
        companyNetAfterPartner:      hasSettled ? totals.Settled - totals.Expenses - (newFormMut.partnerId ? partnerFee : 0) : null,
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
          buildSummaryDoc(ref.id, newFormMut, totals, clientUid, clientName, clientPhone, clientDocId)
        )
      }
      setSettlements(prev => [{ id: ref.id, ...data, ...(!clientUid && { _isOrgSettlement: true }) }, ...prev])
      setShowNew(false)
      setNewForm(EMPTY_FORM(clientPrefill))
      if (isModal) {
        onClose()
      } else {
        setExpanded(ref.id)
        setEditingId(ref.id)
      }
    } finally {
      setSavingNew(false)
    }
  }

  if (loading) {
    const loader = <div className="sl-loading">Loading…</div>
    if (isModal) return (
      <div className="sl-page-overlay">
        <div className="sl-page-modal">{loader}</div>
      </div>
    )
    return loader
  }

  const trackBtn = (
    <button className="sl-btn sl-btn--primary" onClick={() => { setShowNew(true); setExpanded(null) }}>
      + Track New Claim
    </button>
  )

  const bodyContent = (<>

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
            onAddPartner={addPartner}
            onRemovePartner={removePartner}
            onAddInsurer={addInsurer}
            onRemoveInsurer={removeInsurer}
            isNew
          />
        </div>
      )}

      {/* ── Awaiting payment section ── */}
      {(() => {
        const awaiting = settlements.filter(s => n(s.totalSettled) > 0 && !s.paid)
        if (!awaiting.length) return null
        const awaitingTotal = awaiting.reduce((sum, s) => {
          const totalSettled = n(s.totalSettled)
          const totalPaid    = n(s.totalPaidAmount)
          return sum + (totalPaid > 0 ? Math.max(0, totalSettled - totalPaid) : totalSettled)
        }, 0)
        return (
          <div className="sl-awaiting-section">
            <div className="sl-awaiting-header">
              <span className="sl-awaiting-label">⏳ Awaiting Payment</span>
              <span className="sl-awaiting-total">{fmtMoney(awaitingTotal)}</span>
            </div>
            <div className="sl-awaiting-list">
              {awaiting.map(s => {
                const totalSettled = n(s.totalSettled)
                const totalPaid    = n(s.totalPaidAmount)
                const outstanding  = totalPaid > 0 ? Math.max(0, totalSettled - totalPaid) : totalSettled
                return (
                  <div key={s.id} className="sl-awaiting-card">
                    <div className="sl-awaiting-left">
                      <span className="sl-awaiting-claim">{s.claimNumber || 'No claim #'}</span>
                      {s.insuranceCompany && <span className="sl-awaiting-insurer">{s.insuranceCompany}</span>}
                      {s.settlementDate && <span className="sl-awaiting-date">· {fmtDate(s.settlementDate)}</span>}
                      {totalPaid > 0 && <span className="sl-awaiting-rcvd">· {fmtMoney(totalPaid)} rcvd</span>}
                    </div>
                    <span className="sl-awaiting-amt">{fmtMoney(outstanding)} <span className="sl-awaiting-due-label">due</span></span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

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
            phone={clientPhone}
            userId={user.uid}
            userEmail={user.email}
            partners={partners}
            insurers={insurers}
            onAddPartner={addPartner}
            onRemovePartner={removePartner}
            onAddInsurer={addInsurer}
            onRemoveInsurer={removeInsurer}
            expanded={expanded === s.id}
            editing={editingId === s.id}
            onToggle={() => {
              const willExpand = expanded !== s.id
              setExpanded(willExpand ? s.id : null)
              setEditingId(willExpand ? s.id : null)
            }}
            onEdit={() => { setEditingId(s.id); setExpanded(s.id) }}
            onCancelEdit={() => setEditingId(null)}
            onRegisterSave={fn => { activeSaveRef.current = fn }}
            onSaveAndClose={isModal ? onClose : null}
            onSaved={updated => {
              setSettlements(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))
              setEditingId(null)
            }}
            onPaidToggle={updated => setSettlements(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))}
            onDelete={() => setSettlements(prev => prev.filter(x => x.id !== s.id))}
          />
        ))
      )}
  </>)

  if (isModal) {
    return (
      <div className="sl-page-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
        <div className="sl-page-modal">
          <div className="sl-page-modal-header">
            <div>
              <h2 className="sl-title" style={{ margin: 0 }}>Insurance Settlement Tracker</h2>
              {clientName && <p className="sl-sub" style={{ margin: 0 }}>{clientName}</p>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {trackBtn}
              {editingId && (
                <button className="sl-btn sl-btn--primary" onClick={() => activeSaveRef.current?.()}>
                  Save
                </button>
              )}
            </div>
          </div>
          <div className="sl-root sl-root--modal">
            {bodyContent}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sl-root">
      <div className="sl-header">
        <div>
          <button className="sl-back" onClick={() => navigate(-1)}>← Back to Client</button>
          <h2 className="sl-title">Insurance Settlement Tracker</h2>
          {clientName && <p className="sl-sub">{clientName}</p>}
        </div>
        {trackBtn}
      </div>
      {bodyContent}
    </div>
  )
}

// ── Settlement record (summary + expandable detail) ───────────────────────────

function SettlementRecord({ settlement: s, clientUid, clientDocId, clientName, orgId, phone, userId, userEmail, partners, insurers, onAddPartner, onRemovePartner, onAddInsurer, onRemoveInsurer, expanded, editing, onToggle, onEdit, onCancelEdit, onSaved, onDelete, onPaidToggle, onRegisterSave, onSaveAndClose }) {
  const navigate = useNavigate()
  const totals = computeTotals(s)
  const sm = STATUS_META[s.status] || STATUS_META.estimating
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving]     = useState(false)
  const doSaveRef = useRef(null)
  const [saveError, setSaveError] = useState(null)
  const [log, setLog]           = useState(null)
  const [loadingLog, setLoadingLog] = useState(false)
  const [showLogForm, setShowLogForm] = useState(false)
  const [confirmDel, setConfirmDel]  = useState(false)
  const [deleting, setDeleting]      = useState(false)
  const [catPaid, setCatPaid] = useState({
    dryClean:       !!s.dryCleanPaid,
    mitigation:     !!s.mitigationPaid,
    reconstruction: !!s.reconstructionPaid,
    packout:        !!s.packoutPaid,
  })
  const [paidAmounts, setPaidAmounts] = useState({
    dryClean:       n(s.dryCleanPaidAmount),
    mitigation:     n(s.mitigationPaidAmount),
    reconstruction: n(s.reconstructionPaidAmount),
    packout:        n(s.packoutPaidAmount),
  })
  const [togglingCat, setTogglingCat] = useState(null)
  const [savingPaidAmt, setSavingPaidAmt] = useState(null)

  useEffect(() => {
    setCatPaid({
      dryClean:       !!s.dryCleanPaid,
      mitigation:     !!s.mitigationPaid,
      reconstruction: !!s.reconstructionPaid,
      packout:        !!s.packoutPaid,
    })
    setPaidAmounts({
      dryClean:       n(s.dryCleanPaidAmount),
      mitigation:     n(s.mitigationPaidAmount),
      reconstruction: n(s.reconstructionPaidAmount),
      packout:        n(s.packoutPaidAmount),
    })
  }, [s.dryCleanPaid, s.mitigationPaid, s.reconstructionPaid, s.packoutPaid,
      s.dryCleanPaidAmount, s.mitigationPaidAmount, s.reconstructionPaidAmount, s.packoutPaidAmount])

  useEffect(() => {
    if (editing) {
      setEditForm({
        ...s,
        partnerFeeType:  s.partnerFeeType || 'percent',
        partnerFixedFee: s.partnerFixedFee ?? '',
        partnerFeeOnNet: s.partnerFeeOnNet !== false,
      })
      setSaveError(null)
    } else {
      setEditForm(null)
    }
  }, [editing])

  useEffect(() => {
    if (editing) {
      onRegisterSave?.(() => { doSaveRef.current?.() })
    } else {
      onRegisterSave?.(null)
    }
    return () => onRegisterSave?.(null)
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

  doSaveRef.current = doSave

  async function doSave() {
    if (!editForm) return
    setSaving(true)
    setSaveError(null)
    try {
      const totals = computeTotals(editForm)
      const { id: _id, _isOrgSettlement: _flag, ...cleanForm } = editForm
      const hasSettled = totals.Settled > 0
      const recoups = computeCategoryRecoups(editForm, !!editForm.partnerFeeOnNet)
      const partnerFee = hasSettled ? computePartnerFee(editForm, recoups.companyRecoup) : 0
      const updates = {
        ...cleanForm,
        totalEstimate:               totals.Estimate,
        totalSettled:                totals.Settled,
        totalExpenses:               totals.Expenses,
        recoveryRate:                hasSettled ? totals.recoveryRate : null,
        gap:                         hasSettled ? totals.gap          : null,
        grossProfit:                 hasSettled ? totals.grossProfit  : null,
        companyRecoup:               hasSettled ? recoups.companyRecoup : null,
        dryCleanCompanyRecoup:       hasSettled ? recoups.breakdown[0]?.recoup : null,
        mitigationCompanyRecoup:     hasSettled ? recoups.breakdown[1]?.recoup : null,
        reconstructionCompanyRecoup: hasSettled ? recoups.breakdown[2]?.recoup : null,
        packoutCompanyRecoup:        hasSettled ? recoups.breakdown[3]?.recoup : null,
        partnerFee:                  hasSettled && editForm.partnerId ? partnerFee : null,
        companyNetAfterPartner:      hasSettled ? totals.Settled - totals.Expenses - (editForm.partnerId ? partnerFee : 0) : null,
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
          buildSummaryDoc(s.id, updates, totals, clientUid, clientName, phone, clientDocId)
        ).catch(e => console.warn('settlement_summary update:', e))
      }
      onSaved(updates)
      onSaveAndClose?.()
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

  async function doToggleCatPaid(catKey) {
    const nowPaid = !catPaid[catKey]
    const settled = n(s[`${catKey}Settled`])
    // Clicking ✓ to mark paid → fill paid amount to settled; unpaying → clear to 0
    const newPaidAmt = nowPaid ? settled : 0
    const newCatPaid = { ...catPaid, [catKey]: nowPaid }
    setCatPaid(newCatPaid)
    setPaidAmounts(prev => ({ ...prev, [catKey]: newPaidAmt }))
    setTogglingCat(catKey)
    try {
      const totalSettledAmt = CATEGORIES.reduce((sum, c) => sum + n(s[`${c.key}Settled`]), 0)
      const allPaid = totalSettledAmt > 0 && CATEGORIES.every(c => {
        const s2 = n(s[`${c.key}Settled`])
        return s2 <= 0 || newCatPaid[c.key]
      })
      const newTotalPaid = CATEGORIES.reduce((sum, c) => {
        if (c.key === catKey) return sum + newPaidAmt
        return sum + n(s[`${c.key}PaidAmount`])
      }, 0)
      const paidField = `${catKey}Paid`
      const amtField  = `${catKey}PaidAmount`
      const update = {
        [paidField]: nowPaid,
        [amtField]:  newPaidAmt,
        totalPaidAmount:   newTotalPaid,
        totalOutstanding:  n(s.totalSettled) - newTotalPaid,
        paid:     allPaid,
        paidDate: allPaid ? todayStr() : (s.paidDate || null),
        updatedAt: serverTimestamp(),
      }
      const settDocRef = (s._isOrgSettlement || !clientUid)
        ? doc(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', s.id)
        : doc(db, 'users', clientUid, 'settlements', s.id)
      await setDoc(settDocRef, update, { merge: true })
      if (orgId) {
        setDoc(doc(db, 'organization_data', orgId, 'settlement_summary', s.id), update, { merge: true }).catch(() => {})
      }
      onPaidToggle?.({ [paidField]: nowPaid, [amtField]: newPaidAmt, paid: allPaid, paidDate: update.paidDate, totalPaidAmount: newTotalPaid, totalOutstanding: update.totalOutstanding })
    } catch (e) {
      console.error('Toggle cat paid failed:', e)
      setCatPaid(prev => ({ ...prev, [catKey]: !nowPaid }))
      setPaidAmounts(prev => ({ ...prev, [catKey]: nowPaid ? 0 : settled }))
    } finally {
      setTogglingCat(null)
    }
  }

  async function saveCatPaidAmount(catKey, rawVal) {
    const amount  = parseFloat(rawVal) || 0
    const settled = n(s[`${catKey}Settled`])
    const nowPaid = amount > 0 && amount >= settled
    const newCatPaid = { ...catPaid, [catKey]: nowPaid }
    setCatPaid(newCatPaid)
    setSavingPaidAmt(catKey)
    try {
      const totalSettledAmt = CATEGORIES.reduce((sum, c) => sum + n(s[`${c.key}Settled`]), 0)
      const allPaid = totalSettledAmt > 0 && CATEGORIES.every(c => {
        const s2 = n(s[`${c.key}Settled`])
        return s2 <= 0 || newCatPaid[c.key]
      })
      const newTotalPaid = CATEGORIES.reduce((sum, c) => {
        if (c.key === catKey) return sum + amount
        return sum + n(s[`${c.key}PaidAmount`])
      }, 0)
      const paidField = `${catKey}Paid`
      const amtField  = `${catKey}PaidAmount`
      const update = {
        [amtField]:  amount,
        [paidField]: nowPaid,
        totalPaidAmount:  newTotalPaid,
        totalOutstanding: n(s.totalSettled) - newTotalPaid,
        paid:     allPaid,
        paidDate: allPaid ? todayStr() : (s.paidDate || null),
        updatedAt: serverTimestamp(),
      }
      const settDocRef = (s._isOrgSettlement || !clientUid)
        ? doc(db, 'organization_data', orgId, 'clients', clientDocId, 'settlements', s.id)
        : doc(db, 'users', clientUid, 'settlements', s.id)
      await setDoc(settDocRef, update, { merge: true })
      if (orgId) {
        setDoc(doc(db, 'organization_data', orgId, 'settlement_summary', s.id), update, { merge: true }).catch(() => {})
      }
      onPaidToggle?.({ [amtField]: amount, [paidField]: nowPaid, paid: allPaid, paidDate: update.paidDate, totalPaidAmount: newTotalPaid, totalOutstanding: update.totalOutstanding })
    } catch (e) {
      console.error('Save paid amount failed:', e)
    } finally {
      setSavingPaidAmt(null)
    }
  }

  const displayTotals = editing && editForm ? computeTotals(editForm) : totals
  const recovPct = displayTotals.recoveryRate
  const displaySource = editing && editForm ? editForm : s
  const displayRecoups = computeCategoryRecoups(displaySource, !!displaySource.partnerFeeOnNet)
  const displayPartnerFee = displaySource.partnerId ? computePartnerFee(displaySource, displayRecoups.companyRecoup) : 0
  const allPaid = displayTotals.Settled > 0 && CATEGORIES.every(c => {
    const settled = n(s[`${c.key}Settled`])
    return settled <= 0 || catPaid[c.key]
  })
  const partialPaid = !allPaid && CATEGORIES.some(c => catPaid[c.key] && n(s[`${c.key}Settled`]) > 0)

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
            <span className="sl-metric-val" style={{ color: displayTotals.gap > 0 ? '#dc2626' : displayTotals.gap < 0 ? '#15803d' : '#94a3b8' }}>
              {displayTotals.gap > 0
                ? `– ${fmtMoney(displayTotals.gap)}`
                : displayTotals.gap < 0
                ? `+ ${fmtMoney(-displayTotals.gap)}`
                : '—'}
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
          {allPaid && (
            <span className="sl-paid-indicator" title={s.paidDate ? `Paid ${fmtDate(s.paidDate)}` : 'All paid'}>✓ Paid</span>
          )}
          {partialPaid && (
            <span className="sl-partial-paid-indicator">⧗ Partial</span>
          )}
          <span className="sl-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Recovery bar (visible when not editing) ── */}
      {!editing && displayTotals.Settled > 0 && (
        <div className="sl-recovery-bar-wrap">
          <div className="sl-recovery-bar">
            <div className="sl-recovery-fill sl-recovery-fill--settled"
              style={{ width: `${Math.min(100, displayTotals.Settled / displayTotals.Estimate * 100)}%` }} />
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
                onAddPartner={onAddPartner}
                onRemovePartner={onRemovePartner}
                onAddInsurer={onAddInsurer}
                onRemoveInsurer={onRemoveInsurer}
                paidAmounts={paidAmounts}
                catPaid={catPaid}
                onPaidAmountChange={(cat, val) => setPaidAmounts(prev => ({ ...prev, [cat]: val }))}
                onPaidAmountBlur={(cat, val) => saveCatPaidAmount(cat, val)}
                onTogglePaid={doToggleCatPaid}
                togglingCat={togglingCat}
                savingPaidAmt={savingPaidAmt}
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
                      <th className="sl-th-paid">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => {
                      const gap = n(s[`${cat.key}Estimate`]) - n(s[`${cat.key}Settled`])
                      const isPaid = catPaid[cat.key]
                      return (
                        <tr key={cat.key} className={`sl-data-row${isPaid ? ' sl-data-row--paid' : ''}`}>
                          <td className="sl-td-cat">{cat.label}</td>
                          {COL_FIELDS.map(f => {
                            const val = n(s[`${cat.key}${f.key}`])
                            return (
                              <td key={f.key} className="sl-td-num">
                                {val !== 0 ? <span style={{ color: f.color }}>{fmtMoney(val)}</span> : <span className="sl-dash">—</span>}
                              </td>
                            )
                          })}
                          <td className="sl-td-num sl-gap-col">
                            {gap > 0
                              ? <span className="sl-gap-amt">– {fmtMoney(gap)}</span>
                              : gap < 0
                              ? <span style={{ color: '#15803d', fontWeight: 600 }}>+ {fmtMoney(-gap)}</span>
                              : <span className="sl-dash">—</span>}
                          </td>
                          <td className="sl-td-paid">
                            <div className="sl-paid-cell">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className={`sl-paid-amt-input${savingPaidAmt === cat.key ? ' sl-paid-amt-input--saving' : ''}`}
                                placeholder="$ received"
                                value={paidAmounts[cat.key] || ''}
                                onChange={e => setPaidAmounts(prev => ({ ...prev, [cat.key]: e.target.value }))}
                                onBlur={e => saveCatPaidAmount(cat.key, e.target.value)}
                                onClick={e => e.stopPropagation()}
                              />
                              <button
                                className={`sl-cat-paid-btn${isPaid ? ' sl-cat-paid-btn--paid' : ''}`}
                                onClick={e => { e.stopPropagation(); doToggleCatPaid(cat.key) }}
                                disabled={togglingCat === cat.key}
                                title={isPaid ? 'Fully paid — click to unmark' : 'Mark as fully paid'}
                              >✓</button>
                            </div>
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
                          : displayTotals.gap < 0
                          ? <strong style={{ color: '#15803d' }}>+ {fmtMoney(-displayTotals.gap)}</strong>
                          : <span className="sl-dash">—</span>}
                      </td>
                      <td className="sl-td-paid">
                        {(() => {
                          const totalReceived = CATEGORIES.reduce((sum, c) => sum + (paidAmounts[c.key] || 0), 0)
                          const totalSettled  = displayTotals.Settled
                          const outstanding   = Math.max(0, totalSettled - totalReceived)
                          if (totalReceived === 0) return null
                          return (
                            <div className="sl-paid-totals">
                              <span className="sl-paid-received">{fmtMoney(totalReceived)} rcvd</span>
                              {outstanding > 0 && (
                                <span className="sl-paid-outstanding">− {fmtMoney(outstanding)} due</span>
                              )}
                              {outstanding === 0 && totalSettled > 0 && (
                                <span className="sl-paid-tally sl-paid-tally--all">Paid in full</span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Recovery analysis */}
              {displayTotals.Estimate > 0 && (
                <div className="sl-analysis">
                  <RecoveryBar label="Our Estimate"     value={displayTotals.Estimate} max={displayTotals.Estimate} color="#e2e8f0" />
                  {displayTotals.Settled > 0 && (
                    <RecoveryBar label="Final Settlement" value={displayTotals.Settled}   max={displayTotals.Estimate} color="#86efac" highlight />
                  )}
                </div>
              )}

              {/* Profit breakdown */}
              {(displayTotals.Expenses > 0 || displayPartnerFee > 0) && (
                <div className="sl-profit-analysis">
                  <div className="sl-profit-row">
                    <span className="sl-profit-label">Final Settlement</span>
                    <span className="sl-profit-val sl-profit-val--settled">{fmtMoney(displayTotals.Settled)}</span>
                  </div>
                  {displayTotals.Expenses > 0 && (
                    <div className="sl-profit-row sl-profit-row--deduct">
                      <span className="sl-profit-label">Less: Expenses</span>
                      <span className="sl-profit-val sl-profit-val--expense">− {fmtMoney(displayTotals.Expenses)}</span>
                    </div>
                  )}
                  <div className="sl-profit-row sl-profit-row--gross">
                    <span className="sl-profit-label">Gross Profit</span>
                    <span className="sl-profit-val" style={{ color: displayTotals.grossProfit >= 0 ? '#0891b2' : '#dc2626' }}>
                      {fmtMoney(displayTotals.grossProfit)}
                    </span>
                  </div>
                  {displayPartnerFee > 0 && (
                    <div className="sl-profit-row sl-profit-row--deduct">
                      <span className="sl-profit-label">
                        Less: Referral Fee{displaySource.partnerName ? ` (${displaySource.partnerName})` : ''}
                        <span className="sl-fee-basis-chip">{displaySource.partnerFeeOnNet ? 'on net' : 'on gross'}</span>
                      </span>
                      <span className="sl-profit-val sl-profit-val--expense">− {fmtMoney(displayPartnerFee)}</span>
                    </div>
                  )}
                  {displayPartnerFee > 0 && (
                    <div className="sl-profit-row sl-profit-row--net">
                      <span className="sl-profit-label">Net to Company</span>
                      <span className="sl-profit-val sl-profit-val--net">
                        {fmtMoney(displayTotals.grossProfit - displayPartnerFee)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Payment status */}
              {displayTotals.Settled > 0 && (() => {
                const totalReceived  = CATEGORIES.reduce((sum, c) => sum + (paidAmounts[c.key] || 0), 0)
                const outstanding    = Math.max(0, displayTotals.Settled - totalReceived)
                if (totalReceived === 0 && !allPaid) return null
                return (
                  <div className="sl-payment-status">
                    <div className="sl-payment-status-title">Payment Status</div>
                    <div className="sl-payment-status-rows">
                      {CATEGORIES.map(c => {
                        const settled = n(s[`${c.key}Settled`])
                        const received = paidAmounts[c.key] || 0
                        if (settled <= 0) return null
                        const catOutstanding = Math.max(0, settled - received)
                        return (
                          <div key={c.key} className="sl-payment-cat-row">
                            <span className="sl-payment-cat-label">{c.label}</span>
                            <div className="sl-payment-cat-vals">
                              <span style={{ color: '#16a34a' }}>{fmtMoney(settled)} settled</span>
                              {received > 0 && <span style={{ color: '#0891b2' }}>· {fmtMoney(received)} rcvd</span>}
                              {catOutstanding > 0 && <span className="sl-outstanding-chip">− {fmtMoney(catOutstanding)} due</span>}
                              {catOutstanding === 0 && received > 0 && <span className="sl-paid-chip">✓</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {totalReceived > 0 && (
                      <div className="sl-payment-summary-row">
                        <div className="sl-payment-summary-item">
                          <span className="sl-payment-summary-label">Total Received</span>
                          <span className="sl-payment-summary-val" style={{ color: '#0891b2' }}>{fmtMoney(totalReceived)}</span>
                        </div>
                        <div className="sl-payment-summary-item">
                          <span className="sl-payment-summary-label">Outstanding</span>
                          <span className="sl-payment-summary-val" style={{ color: outstanding > 0 ? '#dc2626' : '#15803d', fontWeight: 700 }}>
                            {outstanding > 0 ? fmtMoney(outstanding) : 'Paid in full'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {s.notes && <div className="sl-notes">📝 {s.notes}</div>}

              {allPaid && s.paidDate && (
                <div className="sl-notes" style={{ color: '#15803d', background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  ✓ All payments received {fmtDate(s.paidDate)}
                </div>
              )}

              <div className="sl-detail-actions">
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

function SettlementForm({ form, onChange, claimNumbers, onSave, onCancel, saving, saveError, isNew, partners = [], insurers = [], onAddPartner, onRemovePartner, onAddInsurer, onRemoveInsurer, paidAmounts, catPaid, onPaidAmountChange, onPaidAmountBlur, onTogglePaid, togglingCat, savingPaidAmt }) {
  const hasPaid = !isNew && paidAmounts && onPaidAmountChange
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false)
  const set = (k, v) => onChange(prev => ({ ...prev, [k]: v }))

  function handlePartnerSelect(p) {
    const updates = { partnerId: p.id, partnerName: p.name, partnerFeeType: p.feeType || 'percent' }
    if (p.feeType === 'fixed') {
      updates.partnerFixedFee = p.defaultFixedFee ?? ''
    } else {
      if (p.defaultFeePct != null)               updates.recoupPercent           = p.defaultFeePct
      if (p.defaultReconstructionFeePct != null) updates.reconstructionRecoupPct = p.defaultReconstructionFeePct
    }
    onChange(prev => ({ ...prev, ...updates }))
    setShowFeeBreakdown(false)
  }

  function handlePartnerClear() {
    onChange(prev => ({ ...prev, partnerId: '', partnerName: '', partnerFeeType: 'percent', partnerFixedFee: '', recoupPercent: 0, reconstructionRecoupPct: 0 }))
    setShowFeeBreakdown(false)
  }

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
            onAdd={onAddInsurer}
            onRemove={onRemoveInsurer}
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
              {hasPaid && <th style={{ color: '#0891b2', textAlign: 'center' }}>Received</th>}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(cat => (
              <tr key={cat.key} className={hasPaid && catPaid?.[cat.key] ? 'sl-data-row sl-data-row--paid' : undefined}>
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
                {hasPaid && (
                  <td style={{ textAlign: 'center' }}>
                    <div className="sl-paid-cell" style={{ justifyContent: 'center' }}>
                      <input
                        type="number" min="0" step="0.01"
                        className={`sl-paid-amt-input${savingPaidAmt === cat.key ? ' sl-paid-amt-input--saving' : ''}`}
                        placeholder="$ rcvd"
                        value={paidAmounts[cat.key] || ''}
                        onChange={e => onPaidAmountChange(cat.key, e.target.value)}
                        onBlur={e => onPaidAmountBlur(cat.key, e.target.value)}
                      />
                      <button
                        className={`sl-cat-paid-btn${catPaid?.[cat.key] ? ' sl-cat-paid-btn--paid' : ''}`}
                        onClick={e => { e.stopPropagation(); onTogglePaid(cat.key) }}
                        disabled={togglingCat === cat.key}
                        title={catPaid?.[cat.key] ? 'Mark as unpaid' : 'Mark as fully paid'}
                        type="button"
                      >✓</button>
                    </div>
                  </td>
                )}
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
              {hasPaid && (() => {
                const totalRcvd = CATEGORIES.reduce((s, c) => s + (n(paidAmounts[c.key]) || 0), 0)
                const totalSett = CATEGORIES.reduce((s, c) => s + n(form[`${c.key}Settled`]), 0)
                const outstanding = Math.max(0, totalSett - totalRcvd)
                return (
                  <td className="sl-form-total-cell" style={{ color: '#0891b2', textAlign: 'center' }}>
                    {totalRcvd > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span>{fmtMoney(totalRcvd)}</span>
                        {outstanding > 0
                          ? <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>− {fmtMoney(outstanding)} due</span>
                          : <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>Paid in full ✓</span>}
                      </div>
                    ) : '—'}
                  </td>
                )
              })()}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Partner / Referral Fee */}
      <div className="sl-partner-block">
        <div className="sl-recoup-section-title">Partner / Referral Fee</div>
        <div className="sl-partner-grid">
          <div className="sl-field">
            <label className="sl-label">Who brought this job?</label>
            <PartnerCombobox
              className="sl-input"
              selectedId={form.partnerId || ''}
              selectedName={form.partnerName || ''}
              partners={partners}
              onSelect={handlePartnerSelect}
              onClear={handlePartnerClear}
              onAdd={onAddPartner}
              onRemove={onRemovePartner}
              placeholder="Search or add partner…"
            />
          </div>
          {form.partnerId && form.partnerFeeType !== 'fixed' && (
            <div className="sl-field">
              <label className="sl-label">Fee Based On</label>
              <div className="sl-toggle-row">
                <button type="button"
                  className={`sl-toggle-btn${!form.partnerFeeOnNet ? ' sl-toggle-btn--active' : ''}`}
                  onClick={() => set('partnerFeeOnNet', false)}>Gross Settlement</button>
                <button type="button"
                  className={`sl-toggle-btn${!!form.partnerFeeOnNet ? ' sl-toggle-btn--active' : ''}`}
                  onClick={() => set('partnerFeeOnNet', true)}>Net (after expenses)</button>
              </div>
            </div>
          )}
        </div>

        {/* Partner fee preview */}
        {(() => {
          if (!form.partnerId) return null
          const t = computeTotals(form)
          const hasSettled  = t.Settled  > 0
          const hasEstimate = t.Estimate > 0
          if (!hasSettled && !hasEstimate) return null
          const calcForm = hasSettled ? form : {
            ...form,
            ...CATEGORIES.reduce((acc, cat) => ({
              ...acc, [`${cat.key}Settled`]: form[`${cat.key}Estimate`] || '',
            }), {})
          }
          const { companyRecoup } = computeCategoryRecoups(calcForm, !!form.partnerFeeOnNet)
          const fee            = computePartnerFee(form, companyRecoup)
          const effectiveTotal = hasSettled ? t.Settled  : t.Estimate
          const effectiveExp   = hasSettled ? t.Expenses : 0
          const netToCompany   = effectiveTotal - effectiveExp - fee
          const partnerName    = partners.find(p => p.id === form.partnerId)?.name || 'Partner'
          return (
            <div className="sl-partner-preview">
              {!hasSettled && (
                <div style={{ fontSize: 11, color: '#d97706', marginBottom: 4 }}>
                  Based on estimates — updates when settled
                </div>
              )}
              <span>
                {partnerName} earns:{' '}
                {fee > 0
                  ? <strong>{fmtMoney(fee)}</strong>
                  : <strong style={{ color: '#94a3b8' }}>set referral fee below</strong>}
                {form.partnerFeeType === 'fixed'
                  ? <span className="sl-fee-basis-chip">fixed</span>
                  : <span className="sl-fee-basis-chip">{form.partnerFeeOnNet ? 'on net' : 'on gross'}</span>}
              </span>
              {fee > 0 && (
                <span className="sl-partner-net">
                  Company nets: <strong style={{ color: netToCompany >= 0 ? '#2563eb' : '#dc2626' }}>{fmtMoney(netToCompany)}</strong>
                </span>
              )}
            </div>
          )
        })()}

        {/* Referral fee breakdown — collapsible, only shown when partner selected */}
        {form.partnerId && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="sl-fee-breakdown-toggle"
              onClick={() => setShowFeeBreakdown(v => !v)}
            >
              Edit Referral Fees {showFeeBreakdown ? '▲' : '▼'}
            </button>
            {showFeeBreakdown && (
              <div className="sl-recoup-block" style={{ marginTop: 8 }}>
                {/* Fee type toggle */}
                <div className="sl-field" style={{ marginBottom: 12 }}>
                  <label className="sl-label">Fee Type</label>
                  <div className="sl-toggle-row">
                    <button type="button"
                      className={`sl-toggle-btn${form.partnerFeeType !== 'fixed' ? ' sl-toggle-btn--active' : ''}`}
                      onClick={() => set('partnerFeeType', 'percent')}>% of Settlement</button>
                    <button type="button"
                      className={`sl-toggle-btn${form.partnerFeeType === 'fixed' ? ' sl-toggle-btn--active' : ''}`}
                      onClick={() => set('partnerFeeType', 'fixed')}>Fixed Amount</button>
                  </div>
                </div>

                {form.partnerFeeType === 'fixed' ? (
                  <div className="sl-field">
                    <label className="sl-label">Fixed Referral Fee</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, color: '#64748b' }}>$</span>
                      <input
                        type="number" min="0" step="0.01"
                        className="sl-amount-input"
                        style={{ width: 130 }}
                        placeholder="0.00"
                        value={form.partnerFixedFee ?? ''}
                        onChange={e => set('partnerFixedFee', e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Master slider */}
                    <div className="sl-recoup-master-row">
                      <div className="sl-recoup-header">
                        <label className="sl-label">Referral Fee %</label>
                        <span className="sl-recoup-pct">{n(form.recoupPercent) || 0}%</span>
                      </div>
                      <input type="range" min="0" max="100" step="5"
                        className="sl-recoup-slider"
                        value={n(form.recoupPercent) || 0}
                        onChange={e => set('recoupPercent', Number(e.target.value))} />
                      <div className="sl-recoup-labels">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* Reconstruction override */}
                    {(() => {
                      const cat = CATEGORIES.find(c => c.key === 'reconstruction')
                      const fieldKey = 'reconstructionRecoupPct'
                      const val = form[fieldKey]
                      const effectivePct = (val !== null && val !== undefined && val !== '') ? n(val) : 0
                      const settled = n(form['reconstructionSettled'])
                      const estimate = n(form['reconstructionEstimate'])
                      const baseAmt = settled > 0 ? settled : estimate
                      const expenses = form.partnerFeeOnNet ? n(form['reconstructionExpenses']) : 0
                      const base = Math.max(0, baseAmt - expenses)
                      const recoup = base * effectivePct / 100
                      const isEstimate = settled === 0 && estimate > 0
                      return (
                        <div className="sl-recoup-cats">
                          <div className="sl-recoup-cats-label">Reconstruction Referral Fee %</div>
                          <div className="sl-recoup-cat-row">
                            <span className="sl-recoup-cat-name">{cat.label}</span>
                            <div className="sl-recoup-cat-input-wrap">
                              <input
                                type="number" min="0" max="100" step="1"
                                className="sl-amount-input sl-recoup-cat-input"
                                placeholder="0%"
                                value={val ?? ''}
                                onChange={e => set(fieldKey, e.target.value)}
                              />
                              <span className="sl-recoup-cat-unit">%</span>
                            </div>
                            {baseAmt > 0 && (
                              <span className="sl-recoup-cat-preview">
                                → {fmtMoney(recoup)} ({effectivePct}%){isEstimate ? ' est.' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="sl-field" style={{ marginTop: 14 }}>
        <label className="sl-label">Notes</label>
        <textarea className="sl-textarea" rows={2} value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Internal notes about this claim…" />
      </div>

      {saveError && <p className="sl-save-error">{saveError}</p>}
      {isNew && (
        <div className="sl-form-actions">
          <button className="sl-btn sl-btn--outline" onClick={onCancel} type="button">Cancel</button>
          <button className="sl-btn sl-btn--primary" onClick={onSave} disabled={saving} type="button">
            {saving ? 'Saving…' : 'Create Settlement'}
          </button>
        </div>
      )}
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

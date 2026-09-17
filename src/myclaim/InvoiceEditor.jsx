import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { db, storage } from '../firebase'
import {
  doc, getDoc, setDoc, addDoc, updateDoc,
  collection, getDocs, serverTimestamp, increment, onSnapshot
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useAuth } from './useAuth'
import { generatePDF, fmtMoney, fmtDate } from './invoicePdf'
import NotesAIModal from './NotesAIModal'
import './InvoiceEditor.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

// ── Utilities ─────────────────────────────────────────────────────────────────

const uid6 = () => Math.random().toString(36).slice(2, 8)

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function calcLine(item) {
  const qty   = parseFloat(item.qty)   || 0
  const price = parseFloat(item.price) || 0
  return qty * price
}

function calcTotals(lineItems, taxRate, discount) {
  const subtotal  = lineItems.reduce((s, it) => s + (parseFloat(it.total) || 0), 0)
  const taxAmount = subtotal * ((parseFloat(taxRate) || 0) / 100)
  const disc      = parseFloat(discount) || 0
  return { subtotal, taxAmount, total: subtotal + taxAmount - disc }
}

// Builds a human-readable filename: "Jane Smith_Estimate_(EST-001).pdf"
function buildPdfName(clientName, docType, invNumber, { forStorage = false } = {}) {
  const name = (clientName || 'Client').replace(/[/:*?"<>|\\]/g, '').trim() || 'Client'
  const num  = invNumber ? `_(${invNumber})` : ''
  const base = `${name}_${docType}${num}`
  return forStorage ? `${base.replace(/\s+/g, '_')}.pdf` : `${base}.pdf`
}

async function loadImageAsBase64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const _STATE_ABBRS = Object.keys({AL:1,AK:1,AZ:1,AR:1,CA:1,CO:1,CT:1,DE:1,FL:1,GA:1,HI:1,ID:1,IL:1,IN:1,IA:1,KS:1,KY:1,LA:1,ME:1,MD:1,MA:1,MI:1,MN:1,MS:1,MO:1,MT:1,NE:1,NV:1,NH:1,NJ:1,NM:1,NY:1,NC:1,ND:1,OH:1,OK:1,OR:1,PA:1,RI:1,SC:1,SD:1,TN:1,TX:1,UT:1,VT:1,VA:1,WA:1,WV:1,WI:1,WY:1,DC:1})
const _STATE_SET   = new Set(_STATE_ABBRS)

function extractState(address) {
  if (!address) return ''
  const a = address.toUpperCase()
  let m = a.match(/,\s*([A-Z]{2})\s+\d{5}/)
  if (m && _STATE_SET.has(m[1])) return m[1]
  m = a.match(/,\s*([A-Z]{2})\s*$/)
  if (m && _STATE_SET.has(m[1])) return m[1]
  m = a.match(/\s([A-Z]{2})\s+\d{5}/)
  if (m && _STATE_SET.has(m[1])) return m[1]
  for (const st of _STATE_ABBRS) {
    if (new RegExp(`\\b${st}\\b`).test(a)) return st
  }
  return ''
}

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_TERMS = 'Payment due within 30 days of invoice date. Late payments subject to 1.5% monthly fee.'
const DEFAULT_LINE = () => ({ id: uid6(), label: '', description: '', unit: 'total', qty: 1, price: '', total: 0 })
const UNIT_OPTIONS = ['total', 'sq ft', 'lin ft', 'count', 'hrs', 'days', 'ea']

const STATE_TAXES = {
  '':   { name: '— Select state —', rate: null },
  'AL': { name: 'Alabama',          rate: 4.000 },
  'AK': { name: 'Alaska',           rate: 0.000 },
  'AZ': { name: 'Arizona',          rate: 5.600 },
  'AR': { name: 'Arkansas',         rate: 6.500 },
  'CA': { name: 'California',       rate: 7.250 },
  'CO': { name: 'Colorado',         rate: 2.900 },
  'CT': { name: 'Connecticut',      rate: 6.350 },
  'DE': { name: 'Delaware',         rate: 0.000 },
  'FL': { name: 'Florida',          rate: 6.000 },
  'GA': { name: 'Georgia',          rate: 4.000 },
  'HI': { name: 'Hawaii',           rate: 4.000 },
  'ID': { name: 'Idaho',            rate: 6.000 },
  'IL': { name: 'Illinois',         rate: 6.250 },
  'IN': { name: 'Indiana',          rate: 7.000 },
  'IA': { name: 'Iowa',             rate: 6.000 },
  'KS': { name: 'Kansas',           rate: 6.500 },
  'KY': { name: 'Kentucky',         rate: 6.000 },
  'LA': { name: 'Louisiana',        rate: 4.450 },
  'ME': { name: 'Maine',            rate: 5.500 },
  'MD': { name: 'Maryland',         rate: 6.000 },
  'MA': { name: 'Massachusetts',    rate: 6.250 },
  'MI': { name: 'Michigan',         rate: 6.000 },
  'MN': { name: 'Minnesota',        rate: 6.875 },
  'MS': { name: 'Mississippi',      rate: 7.000 },
  'MO': { name: 'Missouri',         rate: 4.225 },
  'MT': { name: 'Montana',          rate: 0.000 },
  'NE': { name: 'Nebraska',         rate: 5.500 },
  'NV': { name: 'Nevada',           rate: 6.850 },
  'NH': { name: 'New Hampshire',    rate: 0.000 },
  'NJ': { name: 'New Jersey',       rate: 6.625 },
  'NM': { name: 'New Mexico',       rate: 5.000 },
  'NY': { name: 'New York',         rate: 4.000 },
  'NC': { name: 'North Carolina',   rate: 4.750 },
  'ND': { name: 'North Dakota',     rate: 5.000 },
  'OH': { name: 'Ohio',             rate: 5.750 },
  'OK': { name: 'Oklahoma',         rate: 4.500 },
  'OR': { name: 'Oregon',           rate: 0.000 },
  'PA': { name: 'Pennsylvania',     rate: 6.000 },
  'RI': { name: 'Rhode Island',     rate: 7.000 },
  'SC': { name: 'South Carolina',   rate: 6.000 },
  'SD': { name: 'South Dakota',     rate: 4.500 },
  'TN': { name: 'Tennessee',        rate: 7.000 },
  'TX': { name: 'Texas',            rate: 6.250 },
  'UT': { name: 'Utah',             rate: 4.850 },
  'VT': { name: 'Vermont',          rate: 6.000 },
  'VA': { name: 'Virginia',         rate: 5.300 },
  'WA': { name: 'Washington',       rate: 6.500 },
  'WV': { name: 'West Virginia',    rate: 6.000 },
  'WI': { name: 'Wisconsin',        rate: 5.000 },
  'WY': { name: 'Wyoming',          rate: 4.000 },
  'DC': { name: 'Washington DC',    rate: 6.000 },
}

export default function InvoiceEditor() {
  const { id: routeParam, invoiceId } = useParams()
  const isPhoneParam = (routeParam || '').startsWith('+')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const isNew  = !invoiceId || invoiceId === 'new'
  const _qtype = searchParams.get('type')
  const initType = _qtype === 'invoice' ? 'invoice' : _qtype === 'receipt' ? 'receipt' : 'estimate'

  // ── Core state ──
  const [type,      setType]      = useState(initType)
  const [status,    setStatus]    = useState('draft')
  const [invNumber, setInvNumber] = useState('')
  const [issueDate, setIssueDate] = useState(todayStr())
  const [dueDate,   setDueDate]   = useState(addDays(todayStr(), 30))
  const [lineItems, setLineItems] = useState([DEFAULT_LINE()])
  const [taxRate,   setTaxRate]   = useState('')
  const [taxState,  setTaxState]  = useState('')
  const [discount,      setDiscount]      = useState('')
  const [depositAmount, setDepositAmount] = useState('')
  const [notes,       setNotes]       = useState('')
  const [showNotesAI, setShowNotesAI] = useState(false)
  const [terms,     setTerms]     = useState(DEFAULT_TERMS)

  // ── Client / company snapshot ──
  const [clientUid,     setClientUid]     = useState(null)
  const [clientDocId,   setClientDocId]   = useState('')
  const [clientName,    setClientName]    = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPhone,   setClientPhone]   = useState('')
  const [clientEmail,   setClientEmail]   = useState('')
  const [claimNumbers,  setClaimNumbers]  = useState([])
  const [companyName,    setCompanyName]    = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyPhone,   setCompanyPhone]   = useState('')
  const [companyLicense, setCompanyLicense] = useState('')
  const [companyLogoUrl, setCompanyLogoUrl] = useState('')
  const [logoBase64,     setLogoBase64]     = useState(null)
  const [orgId,          setOrgId]          = useState('')

  const [loading,                setLoading]                = useState(true)
  const [saving,                 setSaving]                 = useState(false)
  const [saveMsg,                setSaveMsg]                = useState('')
  const [exporting,              setExporting]              = useState(false)
  const [addingDoc,              setAddingDoc]              = useState(false)
  const [docAdded,               setDocAdded]               = useState(false)
  const [stripePaymentIntentId,  setStripePaymentIntentId]  = useState(null)
  const [depositPaid,            setDepositPaid]            = useState(false)
  const [depositPaidAmount,      setDepositPaidAmount]      = useState(0)
  const [secondaryContacts,      setSecondaryContacts]      = useState([])
  const liveInvRef  = useRef(null)
  const unsubPayRef = useRef(null)

  // ── Pay-link modal state ──
  const [showPayLink,       setShowPayLink]       = useState(false)
  const [payLinkData,       setPayLinkData]       = useState(null)
  const [payLinkLoading,    setPayLinkLoading]    = useState(false)
  const [payLinkError,      setPayLinkError]      = useState('')
  const [payLinkCopied,     setPayLinkCopied]     = useState(false)
  const [payLinkPhones,     setPayLinkPhones]     = useState([])
  const [paymentLinkTodoId, setPaymentLinkTodoId] = useState(null)

  // ── SMS view modal state ──
  const [showSmsView,    setShowSmsView]    = useState(false)
  const [smsViewPhones,  setSmsViewPhones]  = useState([])
  const [smsViewLoading, setSmsViewLoading] = useState(false)
  const [smsViewData,    setSmsViewData]    = useState(null)
  const [smsViewError,   setSmsViewError]   = useState('')
  const [smsViewCopied,  setSmsViewCopied]  = useState(false)

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    load()
  }, [user, routeParam, invoiceId])

  // After save-and-send on a new invoice, the page navigates here with this flag.
  // Open the SMS panel once loading is done and client data is available.
  useEffect(() => {
    if (!loading && location.state?.openSendAfterSave) {
      openSmsView()
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [loading])

  // Real-time listener for payment status — only updates payment fields, never form content
  useEffect(() => {
    if (loading || !liveInvRef.current) return
    if (unsubPayRef.current) unsubPayRef.current()
    unsubPayRef.current = onSnapshot(liveInvRef.current, snap => {
      if (!snap.exists()) return
      const d = snap.data()
      if (d.status !== undefined) setStatus(d.status || 'draft')
      if (d.stripePaymentIntentId) setStripePaymentIntentId(d.stripePaymentIntentId)
      setDepositPaid(!!d.depositPaid)
      setDepositPaidAmount(parseFloat(d.depositPaidAmount) || 0)
    })
    return () => { if (unsubPayRef.current) unsubPayRef.current() }
  }, [loading])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      // Company info
      const orgSnap = await getDoc(doc(db, 'organization_data', oid))
      if (orgSnap.exists()) {
        const od = orgSnap.data()
        setCompanyName(od.companyName || '')
        setCompanyAddress(od.companyAddress || '')
        setCompanyPhone(od.companyPhone || '')
        setCompanyLicense(od.companyLicense || '')
        setCompanyLogoUrl(od.companyLogoUrl || '')
        setLogoBase64(od.companyLogoBase64 || null)

        // Default tax state on new invoices: explicit org setting first, then address fallback
        if (isNew) {
          const abbr = od.defaultTaxState || extractState(od.companyAddress || '')
          if (abbr && STATE_TAXES[abbr]) {
            setTaxState(abbr)
            if (STATE_TAXES[abbr].rate !== null) setTaxRate(String(STATE_TAXES[abbr].rate))
          }
        }
      }

      // Find client by phone param or direct clientDocId fetch
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
      setSecondaryContacts(cdata.secondaryContacts || [])

      // Enrich from users doc
      if (uid) {
        const uSnap = await getDoc(doc(db, 'users', uid))
        if (uSnap.exists()) {
          const ud = uSnap.data()
          setClientName(ud.displayName || cdata.name || '')
          setClientAddress(ud.address || cdata.address || '')
          setClientPhone(ud.phoneNumber || cdata.phone || '')
          setClientEmail(ud.email || '')
          setClaimNumbers(ud.claimNumbers || [])
        }
      } else {
        setClientName(cdata.name || '')
        setClientAddress(cdata.address || '')
        setClientPhone(cdata.phone || '')
        setClaimNumbers(cdata.claimNumbers || [])
      }

      // Pre-fill from navigation state (e.g. Generate Receipt from settlement)
      if (isNew && location.state) {
        const ls = location.state
        if (ls.prefillType) setType(ls.prefillType)
        if (ls.prefillType === 'receipt') setStatus('paid')
        if (ls.prefillNotes) setNotes(ls.prefillNotes)
        if (ls.prefillItems?.length) {
          setLineItems(ls.prefillItems.map(item => ({
            ...DEFAULT_LINE(),
            label: item.label || '',
            unit:  item.unit  || 'total',
            price: String(item.price || ''),
            total: parseFloat(item.price) || 0,
          })))
        }
      }

      // Load existing invoice if editing
      if (!isNew) {
        const invRef = uid
          ? doc(db, 'users', uid, 'invoices', invoiceId)
          : doc(db, 'organization_data', oid, 'clients', docId, 'invoices', invoiceId)
        liveInvRef.current = invRef
        const invSnap = await getDoc(invRef)
        if (invSnap.exists()) {
          const inv = invSnap.data()
          // Fallback: infer from validUntil field (estimates have it, invoices don't)
          setType(inv.type || (inv.validUntil ? 'estimate' : 'invoice'))
          setStatus(inv.status || 'draft')
          setInvNumber(inv.invoiceNumber || '')
          setIssueDate(inv.issueDate || todayStr())
          setDueDate(inv.dueDate || inv.validUntil || addDays(todayStr(), 30))
          setLineItems(inv.lineItems?.length ? inv.lineItems : [DEFAULT_LINE()])
          setTaxRate(inv.taxRate != null ? String(inv.taxRate) : '')
          setTaxState(inv.taxState || '')
          setDiscount(inv.discount != null ? String(inv.discount) : '')
          setDepositAmount(inv.depositAmount != null ? String(inv.depositAmount) : '')
          setNotes(inv.notes || '')
          setTerms(inv.terms || DEFAULT_TERMS)
          if (inv.stripePaymentIntentId) setStripePaymentIntentId(inv.stripePaymentIntentId)
          if (inv.paymentLinkTodoId)    setPaymentLinkTodoId(inv.paymentLinkTodoId)
          setDepositPaid(!!inv.depositPaid)
          setDepositPaidAmount(parseFloat(inv.depositPaidAmount) || 0)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Line items ─────────────────────────────────────────────────────────────

  function updateLine(id, field, value) {
    setLineItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const updated = { ...it, [field]: value }
      updated.total = calcLine(updated)
      return updated
    }))
  }

  function addLine() {
    setLineItems(prev => [...prev, DEFAULT_LINE()])
  }

  function removeLine(id) {
    setLineItems(prev => prev.filter(it => it.id !== id))
  }

  // ── Computed totals ────────────────────────────────────────────────────────

  const totals = calcTotals(lineItems, taxRate, discount)

  // ── Build invoice object ───────────────────────────────────────────────────

  function buildInvoice(overrides = {}) {
    return {
      type,
      status,
      invoiceNumber: invNumber,
      issueDate,
      dueDate:       (type === 'invoice' || type === 'receipt') ? dueDate : null,
      validUntil:    type === 'estimate' ? dueDate : null,
      lineItems:     lineItems.map(it => ({ ...it, total: calcLine(it) })),
      taxRate:       parseFloat(taxRate) || 0,
      taxState:      taxState || '',
      taxAmount:     totals.taxAmount,
      discount:      parseFloat(discount) || 0,
      depositAmount: type === 'invoice' ? (parseFloat(depositAmount) || 0) : 0,
      subtotal:      totals.subtotal,
      total:         totals.total,
      notes:         notes.trim(),
      terms:         terms.trim(),
      // Snapshots
      companyName, companyAddress, companyPhone, companyLicense, companyLogoUrl,
      clientName, clientAddress, clientPhone, clientEmail, claimNumbers,
      updatedAt: serverTimestamp(),
      ...overrides,
    }
  }

  // Mirror key fields to org-level collection for reporting
  async function writeSummary(invDocId, invStatus, paidAmountOverride) {
    if (!orgId || !invDocId) return
    const data = {
      invoiceId:     invDocId,
      clientUid:     clientUid || null,
      clientDocId:   clientDocId || null,
      clientName,
      clientPhone,
      type,
      status:        invStatus,
      invoiceNumber: invNumber,
      total:         totals.total,
      subtotal:      totals.subtotal,
      issueDate,
      dueDate:       (type === 'invoice' || type === 'receipt') ? dueDate : null,
      updatedAt:     serverTimestamp(),
    }
    if (paidAmountOverride !== null) data.paidAmount = paidAmountOverride
    await setDoc(
      doc(db, 'organization_data', orgId, 'invoice_summary', invDocId),
      data,
      { merge: true }
    )
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function getNextNumber(oid, t) {
    const counterRef = doc(db, 'organization_data', oid, 'counters', 'invoices')
    const snap = await getDoc(counterRef)
    const field = t === 'estimate' ? 'nextEstimate' : t === 'receipt' ? 'nextReceipt' : 'nextInvoice'
    const next = snap.exists() ? (snap.data()[field] || 1) : 1
    await setDoc(counterRef, { [field]: next + 1 }, { merge: true })
    const prefix = t === 'estimate' ? 'EST' : t === 'receipt' ? 'RCT' : 'INV'
    return `${prefix}-${String(next).padStart(3, '0')}`
  }

  async function doSave(arg) {
    const statusOverride = typeof arg === 'string' ? arg : null
    const thenOpenSend  = typeof arg === 'object' && !!arg?.thenOpenSend
    if (!orgId || (!clientUid && !clientDocId)) return
    setSaving(true); setSaveMsg('')
    try {
      let num = invNumber
      if (!num) {
        num = await getNextNumber(orgId, type)
        setInvNumber(num)
      }
      const inv = buildInvoice({ invoiceNumber: num, status: statusOverride || status })

      const invColRef = clientUid
        ? collection(db, 'users', clientUid, 'invoices')
        : collection(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices')

      if (isNew) {
        inv.createdAt = serverTimestamp()
        inv.createdBy = user.uid
        const newRef = await addDoc(invColRef, inv)
        await writeSummary(newRef.id, inv.status, 0)

        // Auto-create a pay_invoice todo so the contractor doesn't have to
        if (type === 'invoice' && clientDocId) {
          const todoRef = await addDoc(
            collection(db, 'organization_data', orgId, 'clients', clientDocId, 'todos'),
            {
              label:         `Pay ${num} — ${fmtMoney(totals.total)}`,
              type:          'pay_invoice',
              assignedTo:    'client',
              completed:     false,
              invoiceId:     newRef.id,
              invoiceNumber: num,
              amount:        totals.total,
              createdAt:     serverTimestamp(),
            }
          )
          setPaymentLinkTodoId(todoRef.id)
          // Store the todo ID on the invoice so generatePayLink and the webhook can find it
          updateDoc(newRef, { paymentLinkTodoId: todoRef.id }).catch(() => {})
        }

        navigate(
          `/myclaim/clients/${encodeURIComponent(routeParam)}/invoices/${newRef.id}`,
          { replace: true, state: thenOpenSend ? { openSendAfterSave: true } : undefined }
        )
      } else {
        const invDocRef = clientUid
          ? doc(db, 'users', clientUid, 'invoices', invoiceId)
          : doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', invoiceId)
        await updateDoc(invDocRef, inv)
        await writeSummary(invoiceId, inv.status, null)
        if (statusOverride) setStatus(statusOverride)
      }
      // Bump client updatedAt so the dashboard recent-clients sort reflects this activity
      if (clientDocId) {
        updateDoc(doc(db, 'organization_data', orgId, 'clients', clientDocId), {
          updatedAt: serverTimestamp(),
        }).catch(() => {})
      }
      setSaveMsg('ok')
      setTimeout(() => setSaveMsg(''), 3000)
      return true
    } catch (e) {
      console.error(e); setSaveMsg('err')
      return false
    } finally {
      setSaving(false) }
  }

  async function saveAndSendSms() {
    if (isNew) {
      // Save first — doSave navigates to the real invoice ID.
      // Pass a flag so the new page opens the SMS panel automatically.
      doSave({ thenOpenSend: true })
    } else {
      const ok = await doSave()
      if (ok) openSmsView()
    }
  }

  // ── Convert estimate → invoice ────────────────────────────────────────────

  async function convertToInvoice() {
    if ((!clientUid && !clientDocId) || !orgId || type !== 'estimate') return
    setSaving(true)
    try {
      const invNum     = await getNextNumber(orgId, 'invoice')
      const newDueDate = addDays(todayStr(), 30)
      const newInv = buildInvoice({
        invoiceNumber: invNum,
        type: 'invoice',
        status: 'draft',
        dueDate: newDueDate,
        validUntil: null,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        convertedFromEstimateId: isNew ? null : invoiceId,
      })
      const invColRef = clientUid
        ? collection(db, 'users', clientUid, 'invoices')
        : collection(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices')
      const newRef = await addDoc(invColRef, newInv)

      // Write new invoice to invoice_summary so it appears in OpenWork
      await setDoc(
        doc(db, 'organization_data', orgId, 'invoice_summary', newRef.id),
        {
          invoiceId:     newRef.id,
          clientUid:     clientUid || null,
          clientDocId:   clientDocId || null,
          clientName,
          clientPhone,
          type:          'invoice',
          status:        'draft',
          invoiceNumber: invNum,
          total:         totals.total,
          subtotal:      totals.subtotal,
          issueDate,
          dueDate:       newDueDate,
          updatedAt:     serverTimestamp(),
        },
        { merge: true }
      )

      // Mark estimate as converted (archive it)
      if (!isNew) {
        const estDocRef = clientUid
          ? doc(db, 'users', clientUid, 'invoices', invoiceId)
          : doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', invoiceId)
        await updateDoc(estDocRef, {
          status: 'converted',
          convertedInvoiceId: newRef.id,
          updatedAt: serverTimestamp(),
        })
        // Archive estimate in invoice_summary so OpenWork no longer shows it as active
        await setDoc(
          doc(db, 'organization_data', orgId, 'invoice_summary', invoiceId),
          { status: 'converted', updatedAt: serverTimestamp() },
          { merge: true }
        )
      }
      navigate(`/myclaim/clients/${encodeURIComponent(routeParam)}/invoices/${newRef.id}`)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false) }
  }

  // ── Export PDF ────────────────────────────────────────────────────────────

  async function exportPDF(download = true) {
    setExporting(true)
    try {
      const inv = buildInvoice()
      const pdf = await generatePDF(inv, logoBase64)
      const docType = type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice'
      const filename = buildPdfName(clientName, docType, inv.invoiceNumber)
      if (download) pdf.save(filename)
      else pdf.output('dataurlnewwindow')
    } finally {
      setExporting(false)
    }
  }

  // ── Add PDF to client's document library ─────────────────────────────────

  async function addToClientDocs() {
    if (!clientUid && !clientDocId) return
    setAddingDoc(true)
    try {
      const inv = buildInvoice()
      const pdf = await generatePDF(inv, logoBase64)
      const blob = pdf.output('blob')
      const docType  = type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice'
      const dispName = buildPdfName(clientName, docType, inv.invoiceNumber)
      const storeName = buildPdfName(clientName, docType, inv.invoiceNumber, { forStorage: true })
      const uniqueName = `${Date.now()}_${storeName}`
      // Storage: pre-login uses users/{orgId}/documents/clients/... because the
      // storage rule only covers users/*/documents/** (not organization_data/**).
      const storagePath = clientUid
        ? `users/${clientUid}/documents/${uniqueName}`
        : `users/${orgId}/documents/clients/${clientDocId}/${uniqueName}`

      const sRef = storageRef(storage, storagePath)
      await uploadBytes(sRef, blob, { contentType: 'application/pdf' })
      const downloadURL = await getDownloadURL(sRef)

      // Firestore doc: org path for pre-login so ClientPortal can read it
      const docsColRef = clientUid
        ? collection(db, 'users', clientUid, 'documents')
        : collection(db, 'organization_data', orgId, 'clients', clientDocId, 'documents')
      await addDoc(docsColRef, {
        name:        dispName,
        storagePath,
        downloadURL,
        size:        blob.size,
        folder:      'client',
        uploadedAt:  serverTimestamp(),
        uploadedBy:  user.email || 'contractor',
        source:      'firebase_storage',
      })

      setDocAdded(true)
      setTimeout(() => setDocAdded(false), 5000)
    } catch (e) {
      console.error('addToClientDocs:', e)
    } finally {
      setAddingDoc(false)
    }
  }

  // ── Payment link ──────────────────────────────────────────────────────────

  function openPayLink() {
    const phones = []
    if (clientPhone) phones.push(clientPhone)
    secondaryContacts.forEach(c => { if (c.phone) phones.push(c.phone) })
    setPayLinkPhones(phones)
    setPayLinkData(null)
    setPayLinkError('')
    setShowPayLink(true)
  }

  async function generatePayLink() {
    if (!orgId || !clientDocId || isNew) return
    setPayLinkLoading(true)
    setPayLinkError('')
    try {
      const idToken = await user.getIdToken()
      const r = await fetch(`${BACKEND}/stripe/create-payment-link`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId:        orgId,
          clientDocId:  clientDocId,
          invoiceId:    invoiceId,
          clientUid:    clientUid || null,
          phones:       payLinkPhones,
        }),
      })
      const data = await r.json()
      if (!r.ok || data.error) { setPayLinkError(data.error || 'Could not generate link.'); return }
      setPayLinkData(data)
      setStatus(prev => prev === 'draft' ? 'sent' : prev)

      // Create or refresh the pay_invoice todo under this client
      const todosColRef = collection(db, 'organization_data', orgId, 'clients', clientDocId, 'todos')
      if (paymentLinkTodoId) {
        updateDoc(
          doc(db, 'organization_data', orgId, 'clients', clientDocId, 'todos', paymentLinkTodoId),
          { paymentUrl: data.paymentUrl, completed: false }
        ).catch(() => {})
      } else {
        const todoRef = await addDoc(todosColRef, {
          label:         `Pay ${invNumber || 'Invoice'} — ${fmtMoney(totals.total)}`,
          type:          'pay_invoice',
          assignedTo:    'client',
          completed:     false,
          invoiceId,
          paymentUrl:    data.paymentUrl,
          invoiceNumber: invNumber,
          amount:        totals.total,
          createdAt:     serverTimestamp(),
        })
        setPaymentLinkTodoId(todoRef.id)
        const invDocRef = clientUid
          ? doc(db, 'users', clientUid, 'invoices', invoiceId)
          : doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', invoiceId)
        setDoc(invDocRef, { paymentLinkTodoId: todoRef.id }, { merge: true }).catch(() => {})
      }
    } catch {
      setPayLinkError('Network error. Please try again.')
    } finally {
      setPayLinkLoading(false)
    }
  }

  // ── SMS view link ─────────────────────────────────────────────────────────

  function openSmsView() {
    const phones = []
    if (clientPhone) phones.push(clientPhone)
    secondaryContacts.forEach(c => { if (c.phone) phones.push(c.phone) })
    setSmsViewPhones(phones)
    setSmsViewData(null)
    setSmsViewError('')
    setShowSmsView(true)
  }

  async function sendViewLink() {
    if (!orgId || !clientDocId || isNew) return
    setSmsViewLoading(true)
    setSmsViewError('')
    try {
      const token = crypto.randomUUID().replace(/-/g, '')
      const { updatedAt: _u, ...invSnapshot } = buildInvoice()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await setDoc(doc(db, 'view_links', token), {
        orgId,
        clientDocId,
        invoiceId,
        clientUid: clientUid || null,
        invoice: invSnapshot,
        expiresAt,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      })

      const viewUrl = `${window.location.origin}/myclaim/view/${token}`
      const typeLabel = type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice'
      const msg = `${companyName || 'Your contractor'}: Your ${typeLabel}${invNumber ? ` #${invNumber}` : ''} (${fmtMoney(totals.total)}) is ready to view: ${viewUrl}`

      let smsSent = []
      if (smsViewPhones.length > 0) {
        const [primaryPhone, ...otherPhones] = smsViewPhones
        const idToken = await user.getIdToken()
        const r = await fetch(`${BACKEND}/notify-client`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: primaryPhone,
            type: 'view_invoice',
            message: msg,
            secondaryPhones: otherPhones,
          }),
        })
        const data = await r.json()
        if (!r.ok || data.error) { setSmsViewError(data.error || 'Could not send SMS.'); return }
        smsSent = [{ phone: primaryPhone }, ...(data.secondary || []).map(p => ({ phone: p }))]
      }

      if (status === 'draft' && type !== 'receipt') {
        setStatus('sent')
        const invDocRef = clientUid
          ? doc(db, 'users', clientUid, 'invoices', invoiceId)
          : doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', invoiceId)
        updateDoc(invDocRef, { status: 'sent', updatedAt: serverTimestamp() }).catch(() => {})
        writeSummary(invoiceId, 'sent', null).catch(() => {})
      }

      setSmsViewData({ viewUrl, sms: smsSent })

      if (clientUid) {
        const typeLabel = type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice'
        const phoneCount = smsSent.length
        addDoc(collection(db, 'users', clientUid, 'activity'), {
          type: 'invoice_sent',
          details: `${typeLabel}${invNumber ? ` #${invNumber}` : ''} (${fmtMoney(totals.total)}) view link sent via SMS${phoneCount > 0 ? ` to ${phoneCount} number${phoneCount !== 1 ? 's' : ''}` : ' — link generated'}`,
          timestamp: serverTimestamp(),
          actor: user?.displayName || user?.email || 'contractor',
        }).catch(() => {})
      }
    } catch (e) {
      console.error('sendViewLink:', e)
      setSmsViewError('Network error. Please try again.')
    } finally {
      setSmsViewLoading(false)
    }
  }

  // ── Mark paid modal ───────────────────────────────────────────────────────

  const [showPaid, setShowPaid]           = useState(false)
  const [paidAmount, setPaidAmount]       = useState('')
  const [paidMethod, setPaidMethod]       = useState('check')
  const [paidDate, setPaidDate]           = useState(todayStr())
  const [paidNotes, setPaidNotes]         = useState('')
  const [markingPaid, setMarkingPaid]     = useState(false)

  async function doMarkPaid() {
    if (!clientUid && !clientDocId) return
    setMarkingPaid(true)
    try {
      const updates = {
        status: 'paid',
        paidAt: serverTimestamp(),
        paidAmount: parseFloat(paidAmount) || totals.total,
        paymentMethod: paidMethod,
        paymentNotes: paidNotes.trim(),
        updatedAt: serverTimestamp(),
      }
      if (isNew) {
        await doSave('paid')
      } else {
        const invDocRef = clientUid
          ? doc(db, 'users', clientUid, 'invoices', invoiceId)
          : doc(db, 'organization_data', orgId, 'clients', clientDocId, 'invoices', invoiceId)
        await updateDoc(invDocRef, updates)
        await writeSummary(invoiceId, 'paid', updates.paidAmount)
        setStatus('paid')
      }
      setShowPaid(false)
    } finally {
      setMarkingPaid(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isEstimate = type === 'estimate'
  const isReceipt  = type === 'receipt'

  if (loading) return <div className="ied-loading">Loading…</div>

  return (
    <>
    <div className="ied-root">
      {/* ── Top bar ── */}
      <div className="ied-topbar">
        <button className="ied-back" onClick={() => navigate(-1)}>← Back</button>
        <div className="ied-topbar-center">
          <span className="ied-topbar-label">{isEstimate ? 'Estimate' : isReceipt ? 'Receipt' : 'Invoice'}</span>
          {invNumber && <span className="ied-topbar-num">{invNumber}</span>}
          <span className="ied-status-badge ied-status-badge--small" data-status={status}>{status}</span>
          {stripePaymentIntentId && status === 'paid' && (
            <span className="ied-stripe-badge" title={`Stripe payment: ${stripePaymentIntentId}`}>
              ⚡ Paid via Stripe
            </span>
          )}
        </div>
        <div className="ied-topbar-actions">
          {isReceipt && <span className="ied-paid-stamp">✓ PAID</span>}
          <button className="ied-btn ied-btn--outline" onClick={() => exportPDF(true)} disabled={exporting}>
            ↓ Download
          </button>
          <button className="ied-btn ied-btn--outline" onClick={addToClientDocs}
            disabled={addingDoc || (!clientUid && !clientDocId)}>
            {addingDoc ? 'Uploading…' : docAdded ? '✓ Docs' : '📎 Add to Docs'}
          </button>
          <button className="ied-btn ied-btn--outline" onClick={saveAndSendSms} disabled={saving}>
            Save &amp; Send
          </button>
          <button className="ied-btn ied-btn--primary" onClick={() => doSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {saveMsg === 'ok'  && <div className="ied-banner ied-banner--ok">Saved.</div>}
      {saveMsg === 'err' && <div className="ied-banner ied-banner--err">Could not save. Try again.</div>}
      {status === 'paid' && type !== 'receipt' && (
        <div className="ied-banner ied-banner--paid">
          ✓ Payment received{stripePaymentIntentId ? ' via Stripe' : ''}
        </div>
      )}
      {depositPaid && status !== 'paid' && (
        <div className="ied-banner ied-banner--deposit">
          Deposit received: {fmtMoney(depositPaidAmount)}
          {' · '}Balance remaining: {fmtMoney(Math.max(0, totals.total - depositPaidAmount))}
        </div>
      )}

      <div className="ied-body">
        {/* ── Left column: form ── */}
        <div className="ied-form-col">

          {/* Header info */}
          <div className="ied-card">
            <div className="ied-card-title">Details</div>
            <div className="ied-grid2">
              <div className="ied-field">
                <label className="ied-label">Type</label>
                <select className="ied-input" value={type}
                  onChange={e => setType(e.target.value)}>
                  <option value="estimate">Estimate</option>
                  <option value="invoice">Invoice</option>
                  <option value="receipt">Receipt (Paid)</option>
                </select>
              </div>
              <div className="ied-field">
                <label className="ied-label">Issue Date</label>
                <input className="ied-input" type="date" value={issueDate}
                  onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div className="ied-field">
                <label className="ied-label">{isEstimate ? 'Valid Until' : isReceipt ? 'Payment Date' : 'Due Date'}</label>
                <input className="ied-input" type="date" value={dueDate}
                  onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Company snapshot */}
          <div className="ied-card">
            <div className="ied-card-title">From (Company)</div>
            <div className="ied-snapshot-row">
              {companyLogoUrl
                ? <img src={companyLogoUrl} className="ied-logo" alt="Logo" />
                : <div className="ied-logo-text">{companyName?.[0] || 'U'}</div>
              }
              <div>
                <div className="ied-snapshot-name">{companyName || '—'}</div>
                {companyAddress && <div className="ied-snapshot-detail">{companyAddress}</div>}
                {companyPhone   && <div className="ied-snapshot-detail">{companyPhone}</div>}
                {companyLicense && <div className="ied-snapshot-detail">License # {companyLicense}</div>}
              </div>
            </div>
            <p className="ied-snapshot-hint">Edit in Settings → Company</p>
          </div>

          {/* Client info */}
          <div className="ied-card">
            <div className="ied-card-title">Bill To (Client)</div>
            <div className="ied-grid2">
              <div className="ied-field" style={{ gridColumn: '1 / -1' }}>
                <label className="ied-label">Name</label>
                <input className="ied-input" value={clientName} onChange={e => setClientName(e.target.value)} />
              </div>
              <div className="ied-field" style={{ gridColumn: '1 / -1' }}>
                <label className="ied-label">Address</label>
                <input className="ied-input" value={clientAddress} onChange={e => setClientAddress(e.target.value)} />
              </div>
              <div className="ied-field">
                <label className="ied-label">Phone</label>
                <input className="ied-input" value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
              </div>
              <div className="ied-field">
                <label className="ied-label">Email</label>
                <input className="ied-input" type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
              </div>
              {claimNumbers.length > 0 && (
                <div className="ied-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="ied-label">Claim #(s)</label>
                  <input className="ied-input" value={claimNumbers.join(', ')} readOnly />
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="ied-card">
            <div className="ied-card-title-row">
              <div className="ied-card-title">Line Items</div>
              <button className="ied-add-line" onClick={addLine}>+ Add Item</button>
            </div>

            <div className="ied-items-list">
              {lineItems.map(it => (
                <div key={it.id} className="ied-item-block">
                  {/* Column labels */}
                  <div className="ied-items-header">
                    <span className="ied-items-header-name">Name</span>
                    <span className="ied-items-header-qty">Quantity</span>
                    <span className="ied-items-header-price">Unit Price</span>
                    <span className="ied-items-header-total">Total</span>
                    <span className="ied-items-header-del" />
                  </div>
                  {/* Name + Qty + Price + Total + Delete — all one line */}
                  <div className="ied-item-main-row">
                    <input className="ied-line-input ied-item-name-input"
                      placeholder="e.g. Drywall Repair"
                      value={it.label}
                      onChange={e => updateLine(it.id, 'label', e.target.value)} />
                    <input className="ied-line-input ied-line-num ied-item-qty-input"
                      type="number" min="0" placeholder="1"
                      value={it.qty}
                      onChange={e => updateLine(it.id, 'qty', e.target.value)} />
                    <input className="ied-line-input ied-line-num ied-item-price-input"
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={it.price}
                      onChange={e => updateLine(it.id, 'price', e.target.value)} />
                    <div className="ied-item-total-val">{fmtMoney(calcLine(it))}</div>
                    <button className="ied-line-del" onClick={() => removeLine(it.id)}
                      disabled={lineItems.length === 1} title="Remove">×</button>
                  </div>

                  {/* Description */}
                  <textarea className="ied-item-desc-ta"
                    rows={2}
                    placeholder="Description (optional)"
                    value={it.description}
                    onChange={e => updateLine(it.id, 'description', e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          {/* Totals + adjustments */}
          <div className="ied-card">
            <div className="ied-card-title">Totals &amp; Tax</div>
            <div className="ied-totals-form">
              <div className="ied-field" style={{ gridColumn: '1 / -1' }}>
                <label className="ied-label">Tax State</label>
                <select className="ied-input" value={taxState}
                  onChange={e => {
                    const abbr = e.target.value
                    setTaxState(abbr)
                    const rate = STATE_TAXES[abbr]?.rate
                    if (rate !== null && rate !== undefined) setTaxRate(String(rate))
                  }}>
                  {Object.entries(STATE_TAXES).map(([abbr, { name }]) => (
                    <option key={abbr} value={abbr}>{abbr ? `${abbr} — ${name}` : name}</option>
                  ))}
                </select>
                <span className="ied-field-hint">Selects state base rate. Override below if needed.</span>
              </div>
              <div className="ied-field">
                <label className="ied-label">Tax Rate (%)</label>
                <input className="ied-input" type="number" min="0" step="0.001"
                  placeholder="0" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
              </div>
              <div className="ied-field">
                <label className="ied-label">Discount ($)</label>
                <input className="ied-input" type="number" min="0" step="0.01"
                  placeholder="0.00" value={discount} onChange={e => setDiscount(e.target.value)} />
              </div>
              {type === 'invoice' && (
                <div className="ied-field">
                  <label className="ied-label">Deposit ($)</label>
                  <input className="ied-input" type="number" min="0" step="0.01"
                    placeholder="0.00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                </div>
              )}
            </div>
          </div>

          {/* Notes / Terms */}
          <div className="ied-card">
            <div className="ied-card-title">Notes &amp; Terms</div>
            <div className="ied-field" style={{ marginBottom: 14 }}>
              <div className="ied-label-row">
                <label className="ied-label">Notes (shown on {isEstimate ? 'estimate' : 'invoice'})</label>
                <button className="ied-ai-btn" type="button" onClick={() => setShowNotesAI(true)}
                  title="Generate notes with AI">✨ AI</button>
              </div>
              <textarea className="ied-textarea" rows={3} value={notes}
                placeholder="Any notes for the client…"
                onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="ied-field">
              <label className="ied-label">Terms</label>
              <textarea className="ied-textarea" rows={3} value={terms}
                onChange={e => setTerms(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Right column: summary ── */}
        <div className="ied-summary-col">
          <div className="ied-summary-card">
            <div className="ied-summary-title">Summary</div>
            <div className="ied-summary-row">
              <span>Subtotal</span>
              <span>{fmtMoney(totals.subtotal)}</span>
            </div>
            <div className="ied-summary-row">
              <span>Tax ({taxRate || 0}%)</span>
              <span>{fmtMoney(totals.taxAmount)}</span>
            </div>
            {(parseFloat(discount) || 0) > 0 && (
              <div className="ied-summary-row ied-summary-row--discount">
                <span>Discount</span>
                <span>– {fmtMoney(parseFloat(discount))}</span>
              </div>
            )}
            <div className="ied-summary-divider" />
            <div className="ied-summary-total">
              <span>Total</span>
              <span>{fmtMoney(totals.total)}</span>
            </div>
            {type === 'invoice' && (parseFloat(depositAmount) || 0) > 0 && (
              <div className="ied-summary-row" style={{ marginTop: 8, color: '#2563eb', fontSize: 13 }}>
                <span>Deposit required</span>
                <span>{fmtMoney(parseFloat(depositAmount))}</span>
              </div>
            )}
            <div className="ied-summary-count">{lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}</div>
          </div>

          {/* Primary actions */}
          <div className="ied-summary-card ied-summary-card--actions">
            <button className="ied-btn ied-btn--primary ied-btn--block" onClick={() => doSave()} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save'}
            </button>
            <button className="ied-btn ied-btn--outline ied-btn--block" onClick={saveAndSendSms} disabled={saving}>
              Save &amp; Send SMS
            </button>
            <button className="ied-btn ied-btn--outline ied-btn--block" onClick={() => exportPDF(true)} disabled={exporting}>
              ↓ Download PDF
            </button>
            <button className="ied-btn ied-btn--teal ied-btn--block" onClick={addToClientDocs}
              disabled={addingDoc || (!clientUid && !clientDocId)}>
              {addingDoc ? 'Uploading…' : docAdded ? '✓ Added to Docs' : '📎 Add to Client Docs'}
            </button>
          </div>

          {/* Next steps — only shown when there are actions available */}
          {((isEstimate && status !== 'converted') ||
            (type === 'invoice' && status !== 'paid') ||
            isReceipt) && (
            <div className="ied-summary-card ied-summary-card--actions">
              <div className="ied-action-group-label">Next Steps</div>
              {isEstimate && status !== 'converted' && (
                <button className="ied-btn ied-btn--amber ied-btn--block" onClick={convertToInvoice} disabled={saving}>
                  → Convert to Invoice
                </button>
              )}
              {type === 'invoice' && !isNew && status !== 'paid' && (
                <button className="ied-btn ied-btn--purple ied-btn--block" onClick={openPayLink}>
                  Send for Payment
                </button>
              )}
              {type === 'invoice' && status !== 'paid' && !stripePaymentIntentId && (
                <button className="ied-btn ied-btn--green ied-btn--block" onClick={() => setShowPaid(true)}>
                  ✓ Mark as Paid
                </button>
              )}
              {isReceipt && (
                <div className="ied-paid-block">✓ PAID — settlement receipt</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Send for Payment modal ── */}
      {showPayLink && (
        <div className="ied-overlay" onClick={() => setShowPayLink(false)}>
          <div className="ied-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <h3 className="ied-modal-title">Send for Payment</h3>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 18px' }}>
              Generate a secure payment link for <strong>{invNumber || 'this invoice'}</strong> ({fmtMoney(totals.total)}).
              A 2.9% + $0.30 processing fee is shown to the client at checkout.
            </p>

            {/* Phone checkboxes */}
            {(clientPhone || secondaryContacts.length > 0) ? (
              <div style={{ marginBottom: 18 }}>
                <div className="ied-label" style={{ marginBottom: 8 }}>Send SMS to:</div>
                {[
                  clientPhone ? { phone: clientPhone, label: 'Primary' } : null,
                  ...secondaryContacts.map(c => ({ phone: c.phone, label: c.label || 'Authorized contact' })),
                ].filter(Boolean).map(c => (
                  <label key={c.phone} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13.5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={payLinkPhones.includes(c.phone)}
                      onChange={e => {
                        if (e.target.checked) setPayLinkPhones(p => [...p, c.phone])
                        else setPayLinkPhones(p => p.filter(x => x !== c.phone))
                      }}
                    />
                    <span>{c.phone}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>({c.label})</span>
                  </label>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 18px' }}>
                No phone on file — link will be generated but no SMS sent.
              </p>
            )}

            {/* Success result */}
            {payLinkData && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Link Ready
                </div>
                <div style={{ fontSize: 12.5, color: '#065f46', wordBreak: 'break-all', marginBottom: 10, lineHeight: 1.5 }}>
                  {payLinkData.paymentUrl}
                </div>
                <button
                  className="ied-btn ied-btn--outline"
                  style={{ fontSize: 12.5, padding: '5px 14px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(payLinkData.paymentUrl)
                    setPayLinkCopied(true)
                    setTimeout(() => setPayLinkCopied(false), 2000)
                  }}
                >
                  {payLinkCopied ? '✓ Copied!' : 'Copy Link'}
                </button>
                {payLinkData.sms?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#15803d', marginTop: 10 }}>
                    SMS sent to {payLinkData.sms.filter(s => !s.error).length} of {payLinkData.sms.length} number{payLinkData.sms.length !== 1 ? 's' : ''}.
                  </div>
                )}
              </div>
            )}

            {payLinkError && (
              <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 13.5, marginBottom: 14 }}>
                {payLinkError}
              </div>
            )}

            <div className="ied-modal-actions">
              <button className="ied-btn ied-btn--outline" onClick={() => setShowPayLink(false)}>
                Close
              </button>
              {!payLinkData ? (
                <button className="ied-btn ied-btn--primary" onClick={generatePayLink} disabled={payLinkLoading}>
                  {payLinkLoading ? 'Generating…' : payLinkPhones.length > 0 ? 'Generate & Send SMS' : 'Generate Link'}
                </button>
              ) : (
                <button className="ied-btn ied-btn--outline" onClick={generatePayLink} disabled={payLinkLoading}>
                  {payLinkLoading ? 'Sending…' : 'Resend SMS'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Send via SMS modal ── */}
      {showSmsView && (
        <div className="ied-overlay" onClick={() => setShowSmsView(false)}>
          <div className="ied-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <h3 className="ied-modal-title">Send via SMS</h3>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 18px' }}>
              Share a view link for <strong>{invNumber || 'this document'}</strong> ({fmtMoney(totals.total)}).
              The recipient can view and print the {type === 'estimate' ? 'estimate' : type === 'receipt' ? 'receipt' : 'invoice'} without logging in.
              Link expires in 30 days.
            </p>

            {(clientPhone || secondaryContacts.length > 0) ? (
              <div style={{ marginBottom: 18 }}>
                <div className="ied-label" style={{ marginBottom: 8 }}>Send SMS to:</div>
                {[
                  clientPhone ? { phone: clientPhone, label: 'Primary' } : null,
                  ...secondaryContacts.map(c => ({ phone: c.phone, label: c.label || 'Authorized contact' })),
                ].filter(Boolean).map(c => (
                  <label key={c.phone} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13.5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={smsViewPhones.includes(c.phone)}
                      onChange={e => {
                        if (e.target.checked) setSmsViewPhones(p => [...p, c.phone])
                        else setSmsViewPhones(p => p.filter(x => x !== c.phone))
                      }}
                    />
                    <span>{c.phone}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>({c.label})</span>
                  </label>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 18px' }}>
                No phone on file — link will be generated but no SMS sent.
              </p>
            )}

            {smsViewData && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Link Ready
                </div>
                <div style={{ fontSize: 12.5, color: '#065f46', wordBreak: 'break-all', marginBottom: 10, lineHeight: 1.5 }}>
                  {smsViewData.viewUrl}
                </div>
                <button
                  className="ied-btn ied-btn--outline"
                  style={{ fontSize: 12.5, padding: '5px 14px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(smsViewData.viewUrl)
                    setSmsViewCopied(true)
                    setTimeout(() => setSmsViewCopied(false), 2000)
                  }}
                >
                  {smsViewCopied ? '✓ Copied!' : 'Copy Link'}
                </button>
                {smsViewData.sms?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#15803d', marginTop: 10 }}>
                    SMS sent to {smsViewData.sms.length} number{smsViewData.sms.length !== 1 ? 's' : ''}.
                  </div>
                )}
              </div>
            )}

            {smsViewError && (
              <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 13.5, marginBottom: 14 }}>
                {smsViewError}
              </div>
            )}

            <div className="ied-modal-actions">
              <button className="ied-btn ied-btn--outline" onClick={() => setShowSmsView(false)}>
                Close
              </button>
              {!smsViewData ? (
                <button className="ied-btn ied-btn--primary" onClick={sendViewLink} disabled={smsViewLoading}>
                  {smsViewLoading ? 'Generating…' : smsViewPhones.length > 0 ? 'Generate & Send SMS' : 'Generate Link'}
                </button>
              ) : (
                <button className="ied-btn ied-btn--outline" onClick={sendViewLink} disabled={smsViewLoading}>
                  {smsViewLoading ? 'Sending…' : 'Resend SMS'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Paid modal ── */}
      {showPaid && (
        <div className="ied-overlay" onClick={() => setShowPaid(false)}>
          <div className="ied-modal" onClick={e => e.stopPropagation()}>
            <h3 className="ied-modal-title">Mark as Paid</h3>
            <div className="ied-field" style={{ marginBottom: 14 }}>
              <label className="ied-label">Amount Received</label>
              <input className="ied-input" type="number" step="0.01"
                value={paidAmount} placeholder={String(totals.total.toFixed(2))}
                onChange={e => setPaidAmount(e.target.value)} />
            </div>
            <div className="ied-field" style={{ marginBottom: 14 }}>
              <label className="ied-label">Payment Method</label>
              <select className="ied-input" value={paidMethod} onChange={e => setPaidMethod(e.target.value)}>
                <option value="check">Check</option>
                <option value="zelle">Zelle</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit_card">Credit Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="ied-field" style={{ marginBottom: 14 }}>
              <label className="ied-label">Payment Date</label>
              <input className="ied-input" type="date" value={paidDate}
                onChange={e => setPaidDate(e.target.value)} />
            </div>
            <div className="ied-field" style={{ marginBottom: 20 }}>
              <label className="ied-label">Notes (optional)</label>
              <input className="ied-input" value={paidNotes}
                placeholder="e.g. Check #1234"
                onChange={e => setPaidNotes(e.target.value)} />
            </div>
            <div className="ied-modal-actions">
              <button className="ied-btn ied-btn--outline" onClick={() => setShowPaid(false)}>Cancel</button>
              <button className="ied-btn ied-btn--green" onClick={doMarkPaid} disabled={markingPaid}>
                {markingPaid ? 'Saving…' : 'Mark Paid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {showNotesAI && (
      <NotesAIModal
        clientName={clientName}
        companyName={companyName}
        lineItems={lineItems}
        isEstimate={isEstimate}
        onSelect={text => { setNotes(text); setShowNotesAI(false) }}
        onClose={() => setShowNotesAI(false)}
      />
    )}
    </>
  )
}

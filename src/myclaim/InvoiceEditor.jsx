import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { db, storage } from '../firebase'
import {
  doc, getDoc, setDoc, addDoc, updateDoc,
  collection, getDocs, serverTimestamp, increment
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useAuth } from './useAuth'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import './InvoiceEditor.css'

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

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function calcLine(item) {
  const qty   = parseFloat(item.qty)   || 0
  const price = parseFloat(item.price) || 0
  return item.unit === 'total' ? price : qty * price
}

function calcTotals(lineItems, taxRate, discount) {
  const subtotal  = lineItems.reduce((s, it) => s + (parseFloat(it.total) || 0), 0)
  const taxAmount = subtotal * ((parseFloat(taxRate) || 0) / 100)
  const disc      = parseFloat(discount) || 0
  return { subtotal, taxAmount, total: subtotal + taxAmount - disc }
}

// ── PDF generation ────────────────────────────────────────────────────────────

async function generatePDF(inv, logoUrl) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const margin = 48

  // ── Header band ──
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pw, 88, 'F')

  // Logo or company name
  let headerTextX = margin
  if (logoUrl) {
    try {
      const imgData = await loadImageAsBase64(logoUrl)
      doc.addImage(imgData, 'PNG', margin, 14, 60, 60)
      headerTextX = margin + 72
    } catch { /* fall through to text */ }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text(inv.companyName || 'Company', headerTextX, 38)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(180, 195, 215)
  const companyLines = [
    inv.companyAddress,
    inv.companyPhone,
    inv.companyLicense ? `License: ${inv.companyLicense}` : null,
  ].filter(Boolean)
  doc.text(companyLines.join('  ·  '), headerTextX, 54)

  // Right: doc type + number
  const typeLabel = inv.type === 'estimate' ? 'ESTIMATE' : inv.type === 'receipt' ? 'RECEIPT' : 'INVOICE'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text(typeLabel, pw - margin, 38, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(180, 195, 215)
  doc.text(inv.invoiceNumber || '', pw - margin, 54, { align: 'right' })

  let y = 110

  // ── Meta row (issued / due / valid) ──
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('ISSUED', margin, y)
  doc.text(inv.type === 'invoice' ? 'DUE DATE' : inv.type === 'receipt' ? 'PAYMENT DATE' : 'VALID UNTIL', margin + 130, y)

  y += 13
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(fmtDate(inv.issueDate), margin, y)
  doc.text(fmtDate(inv.dueDate || inv.validUntil), margin + 130, y)

  if (inv.claimNumbers?.length) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.text('CLAIM #', margin + 280, y - 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(inv.claimNumbers.join(', '), margin + 280, y)
  }

  y += 24

  // ── Divider ──
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pw - margin, y)
  y += 18

  // ── Bill To ──
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('BILL TO', margin, y)
  y += 13
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text(inv.clientName || '', margin, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  if (inv.clientAddress) { doc.text(inv.clientAddress, margin, y); y += 13 }
  if (inv.clientPhone)   { doc.text(inv.clientPhone,   margin, y); y += 13 }
  if (inv.clientEmail)   { doc.text(inv.clientEmail,   margin, y); y += 13 }

  y += 16

  // ── Line items table ──
  const rows = (inv.lineItems || []).map(it => [
    it.label,
    it.description || '',
    it.unit === 'total' ? 'lump sum' : `${it.qty} ${it.unit}`,
    fmtMoney(it.price),
    fmtMoney(parseFloat(it.total) || 0),
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Item', 'Description', 'Qty / Unit', 'Price', 'Total']],
    body: rows,
    styles: { fontSize: 10, cellPadding: 7 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 'auto', textColor: [100, 116, 139] },
      2: { cellWidth: 90, halign: 'center' },
      3: { cellWidth: 80, halign: 'right' },
      4: { cellWidth: 80, halign: 'right', fontStyle: 'bold' },
    },
  })

  y = doc.lastAutoTable.finalY + 16

  // ── Totals ──
  const totW = 200
  const totX = pw - margin - totW

  const totRows = [
    ['Subtotal', fmtMoney(inv.subtotal)],
    [`Tax (${inv.taxRate || 0}%)`, fmtMoney(inv.taxAmount)],
  ]
  if (inv.discount > 0) totRows.push(['Discount', `– ${fmtMoney(inv.discount)}`])

  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  totRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal')
    doc.text(label, totX, y)
    doc.text(val, pw - margin, y, { align: 'right' })
    y += 16
  })

  doc.setFontSize(0.5)
  doc.setDrawColor(226, 232, 240)
  doc.line(totX, y - 4, pw - margin, y - 4)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text('TOTAL', totX, y + 12)
  doc.text(fmtMoney(inv.total), pw - margin, y + 12, { align: 'right' })
  y += 30

  // ── Notes / Terms ──
  if (inv.notes) {
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('NOTES', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(71, 85, 105)
    const noteLines = doc.splitTextToSize(inv.notes, pw - 2 * margin)
    doc.text(noteLines, margin, y)
    y += noteLines.length * 13
  }

  if (inv.terms) {
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('TERMS', margin, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(71, 85, 105)
    const termLines = doc.splitTextToSize(inv.terms, pw - 2 * margin)
    doc.text(termLines, margin, y)
  }

  // ── Footer ──
  const ph = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(inv.companyName || '', pw / 2, ph - 20, { align: 'center' })

  // ── PAID watermark ──
  if (inv.type === 'receipt' || inv.status === 'paid') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(110)
    doc.setTextColor(187, 247, 208) // very light green — visible but non-intrusive
    doc.text('PAID', pw / 2, ph / 2 + 40, { align: 'center', angle: 40 })
  }

  return doc
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function loadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = url
  })
}

// Extract 2-letter US state abbreviation from an address string like "123 Main St, Chicago, IL 60601"
function extractState(address) {
  if (!address) return ''
  const m = address.match(/[,\s]+([A-Z]{2})\s+\d{5}/)
  return m ? m[1] : ''
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
  const { id: phone, invoiceId } = useParams()
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
  const [discount,  setDiscount]  = useState('')
  const [notes,     setNotes]     = useState('')
  const [terms,     setTerms]     = useState(DEFAULT_TERMS)

  // ── Client / company snapshot ──
  const [clientUid,     setClientUid]     = useState(null)
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
  const [orgId,          setOrgId]          = useState('')

  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saveMsg,   setSaveMsg]   = useState('')
  const [exporting, setExporting] = useState(false)
  const [addingDoc, setAddingDoc] = useState(false)
  const [docAdded,  setDocAdded]  = useState(false)

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    load()
  }, [user, phone, invoiceId])

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

        // Default tax state from company address (only for new invoices)
        if (isNew) {
          const abbr = extractState(od.companyAddress || '')
          if (abbr && STATE_TAXES[abbr]) {
            setTaxState(abbr)
            if (STATE_TAXES[abbr].rate !== null) setTaxRate(String(STATE_TAXES[abbr].rate))
          }
        }
      }

      // Find client by phone
      const clientsSnap = await getDocs(collection(db, 'organization_data', oid, 'clients'))
      const clientDoc = clientsSnap.docs.find(d => {
        const p = d.data().phone || ''
        return p === phone || p.replace(/\D/g,'') === phone.replace(/\D/g,'')
      })
      if (!clientDoc) return

      const cdata = clientDoc.data()
      const uid = cdata.uid
      setClientUid(uid)

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
      if (!isNew && uid) {
        const invSnap = await getDoc(doc(db, 'users', uid, 'invoices', invoiceId))
        if (invSnap.exists()) {
          const inv = invSnap.data()
          setType(inv.type || 'invoice')
          setStatus(inv.status || 'draft')
          setInvNumber(inv.invoiceNumber || '')
          setIssueDate(inv.issueDate || todayStr())
          setDueDate(inv.dueDate || inv.validUntil || addDays(todayStr(), 30))
          setLineItems(inv.lineItems?.length ? inv.lineItems : [DEFAULT_LINE()])
          setTaxRate(inv.taxRate != null ? String(inv.taxRate) : '')
          setTaxState(inv.taxState || '')
          setDiscount(inv.discount != null ? String(inv.discount) : '')
          setNotes(inv.notes || '')
          setTerms(inv.terms || DEFAULT_TERMS)
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
  async function writeSummary(docId, invStatus, paidAmountOverride) {
    if (!orgId || !docId || !clientUid) return
    const data = {
      invoiceId:     docId,
      clientUid,
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
      doc(db, 'organization_data', orgId, 'invoice_summary', docId),
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

  async function doSave(statusOverride) {
    if (!clientUid || !orgId) return
    setSaving(true); setSaveMsg('')
    try {
      let num = invNumber
      if (!num) {
        num = await getNextNumber(orgId, type)
        setInvNumber(num)
      }
      const inv = buildInvoice({ invoiceNumber: num, status: statusOverride || status })

      if (isNew) {
        inv.createdAt = serverTimestamp()
        inv.createdBy = user.uid
        const newRef = await addDoc(collection(db, 'users', clientUid, 'invoices'), inv)
        await writeSummary(newRef.id, inv.status, 0)
        navigate(`/myclaim/clients/${encodeURIComponent(phone)}/invoices/${newRef.id}`, { replace: true })
      } else {
        await updateDoc(doc(db, 'users', clientUid, 'invoices', invoiceId), inv)
        await writeSummary(invoiceId, inv.status, null)
        if (statusOverride) setStatus(statusOverride)
      }
      setSaveMsg('ok')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) {
      console.error(e); setSaveMsg('err')
    } finally {
      setSaving(false) }
  }

  // ── Convert estimate → invoice ────────────────────────────────────────────

  async function convertToInvoice() {
    if (!clientUid || !orgId || type !== 'estimate') return
    setSaving(true)
    try {
      const invNum = await getNextNumber(orgId, 'invoice')
      const newInv = buildInvoice({
        invoiceNumber: invNum,
        type: 'invoice',
        status: 'draft',
        dueDate: addDays(todayStr(), 30),
        validUntil: null,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        convertedFromEstimateId: isNew ? null : invoiceId,
      })
      const newRef = await addDoc(collection(db, 'users', clientUid, 'invoices'), newInv)

      // Mark estimate as converted
      if (!isNew) {
        await updateDoc(doc(db, 'users', clientUid, 'invoices', invoiceId), {
          status: 'converted',
          convertedInvoiceId: newRef.id,
          updatedAt: serverTimestamp(),
        })
      }
      navigate(`/myclaim/clients/${encodeURIComponent(phone)}/invoices/${newRef.id}`)
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
      const pdf = await generatePDF(inv, companyLogoUrl || null)
      const filename = `${inv.invoiceNumber || (type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice')}.pdf`
      if (download) pdf.save(filename)
      else pdf.output('dataurlnewwindow')
    } finally {
      setExporting(false)
    }
  }

  // ── Add PDF to client's document library ─────────────────────────────────

  async function addToClientDocs() {
    if (!clientUid) return
    setAddingDoc(true)
    try {
      const inv = buildInvoice()
      const pdf = await generatePDF(inv, companyLogoUrl || null)
      const blob = pdf.output('blob')
      const label = inv.invoiceNumber || (type === 'estimate' ? 'Estimate' : type === 'receipt' ? 'Receipt' : 'Invoice')
      const filename = `${label}-${Date.now()}.pdf`
      const path = `users/${clientUid}/documents/${filename}`

      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, blob, { contentType: 'application/pdf' })
      const downloadURL = await getDownloadURL(sRef)

      await addDoc(collection(db, 'users', clientUid, 'documents'), {
        name:        `${label}.pdf`,
        storagePath: path,
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

  // ── Mark paid modal ───────────────────────────────────────────────────────

  const [showPaid, setShowPaid]           = useState(false)
  const [paidAmount, setPaidAmount]       = useState('')
  const [paidMethod, setPaidMethod]       = useState('check')
  const [paidDate, setPaidDate]           = useState(todayStr())
  const [paidNotes, setPaidNotes]         = useState('')
  const [markingPaid, setMarkingPaid]     = useState(false)

  async function doMarkPaid() {
    if (!clientUid) return
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
        await updateDoc(doc(db, 'users', clientUid, 'invoices', invoiceId), updates)
        await writeSummary(invoiceId, 'paid', updates.paidAmount)
        setStatus('paid')
      }
      setShowPaid(false)
    } finally {
      setMarkingPaid(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const backPath = `/myclaim/clients/${encodeURIComponent(phone)}/invoices`
  const isEstimate = type === 'estimate'
  const isReceipt  = type === 'receipt'

  if (loading) return <div className="ied-loading">Loading…</div>

  return (
    <div className="ied-root">
      {/* ── Top bar ── */}
      <div className="ied-topbar">
        <button className="ied-back" onClick={() => navigate(backPath)}>← Back</button>
        <div className="ied-topbar-center">
          <span className="ied-topbar-label">{isEstimate ? 'Estimate' : isReceipt ? 'Receipt' : 'Invoice'}</span>
          {invNumber && <span className="ied-topbar-num">{invNumber}</span>}
          <span className="ied-status-badge ied-status-badge--small" data-status={status}>{status}</span>
        </div>
        <div className="ied-topbar-actions">
          {isEstimate && status !== 'converted' && (
            <button className="ied-btn ied-btn--outline" onClick={convertToInvoice} disabled={saving}>
              → Convert to Invoice
            </button>
          )}
          {(type === 'invoice') && status !== 'paid' && (
            <button className="ied-btn ied-btn--green" onClick={() => setShowPaid(true)}>
              Mark Paid
            </button>
          )}
          {isReceipt && (
            <span className="ied-paid-stamp">✓ PAID</span>
          )}
          <button className="ied-btn ied-btn--outline" onClick={() => exportPDF(false)} disabled={exporting}>
            {exporting ? 'Generating…' : 'Preview PDF'}
          </button>
          <button className="ied-btn ied-btn--outline" onClick={() => exportPDF(true)} disabled={exporting}>
            ↓ Download PDF
          </button>
          <button className="ied-btn ied-btn--teal" onClick={addToClientDocs}
            disabled={addingDoc || !clientUid} title="Upload PDF to client's document portal">
            {addingDoc ? 'Uploading…' : docAdded ? '✓ Added to Docs' : '📎 Add to Client Docs'}
          </button>
          <button className="ied-btn ied-btn--primary" onClick={() => doSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {saveMsg === 'ok'  && <div className="ied-banner ied-banner--ok">Saved.</div>}
      {saveMsg === 'err' && <div className="ied-banner ied-banner--err">Could not save. Try again.</div>}

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
                <div className="ied-snapshot-detail">{companyAddress}</div>
                <div className="ied-snapshot-detail">{companyPhone}{companyLicense ? ` · License: ${companyLicense}` : ''}</div>
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

            <div className="ied-line-header">
              <span style={{ flex: 2 }}>Item</span>
              <span style={{ flex: 2 }}>Description</span>
              <span style={{ flex: 1 }}>Unit</span>
              <span style={{ width: 60, textAlign: 'right' }}>Qty</span>
              <span style={{ width: 90, textAlign: 'right' }}>Price</span>
              <span style={{ width: 90, textAlign: 'right' }}>Total</span>
              <span style={{ width: 28 }} />
            </div>

            {lineItems.map(it => (
              <div key={it.id} className="ied-line-row">
                <input className="ied-line-input" style={{ flex: 2 }}
                  placeholder="e.g. Drywall Repair" value={it.label}
                  onChange={e => updateLine(it.id, 'label', e.target.value)} />
                <input className="ied-line-input" style={{ flex: 2 }}
                  placeholder="Optional note" value={it.description}
                  onChange={e => updateLine(it.id, 'description', e.target.value)} />
                <select className="ied-line-select" style={{ flex: 1 }}
                  value={it.unit} onChange={e => updateLine(it.id, 'unit', e.target.value)}>
                  {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
                </select>
                <input className="ied-line-input ied-line-num" style={{ width: 60 }}
                  type="number" min="0" placeholder="1"
                  value={it.unit === 'total' ? '' : it.qty}
                  disabled={it.unit === 'total'}
                  onChange={e => updateLine(it.id, 'qty', e.target.value)} />
                <input className="ied-line-input ied-line-num" style={{ width: 90 }}
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={it.price}
                  onChange={e => updateLine(it.id, 'price', e.target.value)} />
                <div className="ied-line-total" style={{ width: 90 }}>
                  {fmtMoney(calcLine(it))}
                </div>
                <button className="ied-line-del" onClick={() => removeLine(it.id)}
                  disabled={lineItems.length === 1} title="Remove">×</button>
              </div>
            ))}
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
            </div>
          </div>

          {/* Notes / Terms */}
          <div className="ied-card">
            <div className="ied-card-title">Notes &amp; Terms</div>
            <div className="ied-field" style={{ marginBottom: 14 }}>
              <label className="ied-label">Notes (shown on {isEstimate ? 'estimate' : 'invoice'})</label>
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
            <div className="ied-summary-count">{lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="ied-summary-card ied-summary-card--actions">
            <button className="ied-btn ied-btn--primary ied-btn--block" onClick={() => doSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="ied-btn ied-btn--outline ied-btn--block" onClick={() => exportPDF(true)} disabled={exporting}>
              ↓ Download PDF
            </button>
            <button className="ied-btn ied-btn--teal ied-btn--block" onClick={addToClientDocs}
              disabled={addingDoc || !clientUid}>
              {addingDoc ? 'Uploading…' : docAdded ? '✓ Added to Docs' : '📎 Add to Client Docs'}
            </button>
            {isEstimate && status !== 'converted' && (
              <button className="ied-btn ied-btn--amber ied-btn--block" onClick={convertToInvoice} disabled={saving}>
                → Convert to Invoice
              </button>
            )}
            {type === 'invoice' && status !== 'paid' && (
              <button className="ied-btn ied-btn--green ied-btn--block" onClick={() => setShowPaid(true)}>
                ✓ Mark as Paid
              </button>
            )}
            {isReceipt && (
              <div className="ied-paid-block">✓ PAID — settlement receipt</div>
            )}
          </div>
        </div>
      </div>

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
  )
}

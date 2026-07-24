import React, { useState, useEffect, useRef } from 'react'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, storage } from '../firebase'
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, orderBy, where, addDoc, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useAuth } from './useAuth'
import { api } from './api'
import TemplateBuilder from './TemplateBuilder'
import './Settings.css'
import './TeamSettings.css'

// ── Constants ────────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'admin',           label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'public_adjuster', label: 'Public Adjuster' },
]

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']
const US_STATE_SET = new Set(US_STATES)

// ── Helpers ───────────────────────────────────────────────────────────────────

const encodeEmail = (email) =>
  email.toLowerCase().replace(/\./g, '__dot__').replace(/@/g, '__at__')

function detectStateFromAddress(address) {
  if (!address) return ''
  const a = address.toUpperCase()
  let m = a.match(/,\s*([A-Z]{2})\s+\d{5}/)
  if (m && US_STATE_SET.has(m[1])) return m[1]
  m = a.match(/,\s*([A-Z]{2})\s*$/)
  if (m && US_STATE_SET.has(m[1])) return m[1]
  m = a.match(/\s([A-Z]{2})\s+\d{5}/)
  if (m && US_STATE_SET.has(m[1])) return m[1]
  for (const st of US_STATES) {
    if (new RegExp(`\\b${st}\\b`).test(a)) return st
  }
  return ''
}

function resizeLogoToBase64(file, maxPx = 300) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(blobUrl)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Image load failed')) }
    img.src = blobUrl
  })
}

const formatPhone = (phone = '') => {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return phone
}

const fmtDate = (ts) => {
  if (!ts) return 'Never'
  const d = ts.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth()

  // Core
  const [role,  setRole]  = useState(null)
  const [orgId, setOrgId] = useState('')
  const [loading, setLoading] = useState(true)

  // Tab
  const isAdmin = role === null || role === 'admin'
  const ADMIN_TABS  = ['Company', 'My Profile', 'Account', 'Team', 'Integrations', 'Templates', 'Data']
  const USER_TABS   = ['My Profile', 'Account']
  const tabs = isAdmin ? ADMIN_TABS : USER_TABS
  const [activeTab, setActiveTab] = useState('My Profile')
  useEffect(() => { if (role !== null) setActiveTab(isAdmin ? 'Company' : 'My Profile') }, [role])

  // ── Company ──────────────────────────────────────────────────────────────
  const [companyName,      setCompanyName]      = useState('')
  const [companyAddress,   setCompanyAddress]   = useState('')
  const [companyPhone,     setCompanyPhone]     = useState('')
  const [companyLicense,   setCompanyLicense]   = useState('')
  const [companyLogoUrl,   setCompanyLogoUrl]   = useState('')
  const [defaultTaxState,  setDefaultTaxState]  = useState('')
  const [googleReviewUrl,  setGoogleReviewUrl]  = useState('')
  const [uploadingLogo,    setUploadingLogo]    = useState(false)
  const [savingCompany,    setSavingCompany]    = useState(false)
  const [companyMsg,       setCompanyMsg]       = useState('')
  const logoInputRef = useRef(null)

  // ── My Profile ───────────────────────────────────────────────────────────
  const [techName,     setTechName]     = useState('')
  const [techPhone,    setTechPhone]    = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [savingTech,   setSavingTech]   = useState(false)
  const [techMsg,      setTechMsg]      = useState('')

  // ── Account / Password ───────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg,     setPwMsg]     = useState('')
  const [pwErr,     setPwErr]     = useState('')
  const [savingPw,  setSavingPw]  = useState(false)

  // ── Team ─────────────────────────────────────────────────────────────────
  const [members,     setMembers]     = useState([])
  const [invites,     setInvites]     = useState([])
  const [clients,     setClients]     = useState([])
  const [savingId,    setSavingId]    = useState(null)
  const [removingId,  setRemovingId]  = useState(null)
  const [cancelingId, setCancelingId] = useState(null)
  const [assignModal,  setAssignModal]  = useState(null)
  const [assignDraft,  setAssignDraft]  = useState([])
  const [assignSearch, setAssignSearch] = useState('')
  const [assignSaving, setAssignSaving] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail,     setInviteEmail]     = useState('')
  const [inviteRole,      setInviteRole]      = useState('project_manager')
  const [inviting,        setInviting]        = useState(false)
  const [inviteError,     setInviteError]     = useState('')

  // ── Templates ────────────────────────────────────────────────────────────
  const [templates,        setTemplates]        = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [showTplBuilder,   setShowTplBuilder]   = useState(false)
  const [editingTemplate,  setEditingTemplate]  = useState(null)
  const [builderFile,      setBuilderFile]      = useState(null)
  const [deletingTplId,    setDeletingTplId]    = useState(null)
  const tplFileRef = useRef(null)

  // ── Integrations ─────────────────────────────────────────────────────────
  const [driveStatus,   setDriveStatus]   = useState(null)
  const [driveLoading,  setDriveLoading]  = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [ccApiKey,      setCcApiKey]      = useState('')
  const [ccApiInput,    setCcApiInput]    = useState('')
  const [ccEditing,     setCcEditing]     = useState(false)
  const [ccSaving,      setCcSaving]      = useState(false)
  const [ccLoading,     setCcLoading]     = useState(true)
  const [ccMessage,     setCcMessage]     = useState('')

  // ── Data Cleanup ─────────────────────────────────────────────────────────
  const [cleanupName,      setCleanupName]      = useState('')
  const [cleanupResults,   setCleanupResults]   = useState(null)
  const [cleanupSearching, setCleanupSearching] = useState(false)
  const [cleanupDeleting,  setCleanupDeleting]  = useState(false)
  const [cleanupDone,      setCleanupDone]      = useState(false)
  const [orphanScanning,   setOrphanScanning]   = useState(false)
  const [orphanResults,    setOrphanResults]    = useState(null)
  const [orphanDeleting,   setOrphanDeleting]   = useState(false)
  const [orphanDone,       setOrphanDone]       = useState(false)

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid))
        const oid = userSnap.data()?.organizationId
        if (!oid || cancelled) return
        setOrgId(oid)

        const [orgSnap, contractorSnap, membersSnap, clientsSnap, invitesSnap, driveStatusRes] = await Promise.all([
          getDoc(doc(db, 'organization_data', oid)),
          getDoc(doc(db, 'organization_data', oid, 'contractors', user.uid)),
          getDocs(query(collection(db, 'organization_data', oid, 'contractors'), orderBy('lastLogin', 'desc'))),
          getDocs(collection(db, 'organization_data', oid, 'clients')),
          getDocs(query(collection(db, 'organization_data', oid, 'invites'), orderBy('invitedAt', 'desc'))).catch(() => ({ docs: [] })),
          api.drive.status(oid).catch(() => ({ connected: false })),
        ])
        if (cancelled) return

        // Company
        if (orgSnap.exists()) {
          const od = orgSnap.data()
          setCompanyName(od.companyName || '')
          setCompanyAddress(od.companyAddress || '')
          setCompanyPhone(od.companyPhone || '')
          setCompanyLicense(od.companyLicense || '')
          setCompanyLogoUrl(od.companyLogoUrl || '')
          setDefaultTaxState(od.defaultTaxState || '')
          setGoogleReviewUrl(od.googleReviewUrl || '')
          setCcApiKey(od.companyCamAPI || '')
        }

        // Profile & role
        const cd = contractorSnap.exists() ? contractorSnap.data() : {}
        setRole(cd.role || 'admin')
        setTechName(cd.displayName || user.displayName || '')
        setTechPhone(cd.phone || '')
        setContactEmail(cd.contactEmail || '')

        // Team
        setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setInvites(invitesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setClients(
          clientsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(c => c.phone)
            .sort((a, b) => (a.name || a.phone || '').localeCompare(b.name || b.phone || ''))
        )

        // Integrations
        setDriveStatus(driveStatusRes)
        setDriveLoading(false)
        setCcLoading(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    if (!orgId) return
    setTemplatesLoading(true)
    getDocs(collection(db, 'organization_data', orgId, 'signTemplates'))
      .then(snap => setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setTemplatesLoading(false))
  }, [orgId])

  // ── Company handlers ──────────────────────────────────────────────────────

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !orgId) return
    if (!file.type.startsWith('image/')) { setCompanyMsg('err-logo'); return }
    setUploadingLogo(true); setCompanyMsg('')
    try {
      const ext = file.name.split('.').pop()
      const logoRef = ref(storage, `organizations/${orgId}/logo/logo.${ext}`)
      await uploadBytes(logoRef, file, { contentType: file.type })
      const url = await getDownloadURL(logoRef)
      const base64 = await resizeLogoToBase64(file, 300)
      setCompanyLogoUrl(url)
      await setDoc(doc(db, 'organization_data', orgId), { companyLogoUrl: url, companyLogoBase64: base64 }, { merge: true })
      setCompanyMsg('ok-logo')
      setTimeout(() => setCompanyMsg(''), 3000)
    } catch { setCompanyMsg('err-logo-upload') }
    finally { setUploadingLogo(false) }
  }

  const saveCompany = async (e) => {
    e.preventDefault()
    if (!orgId) return
    setSavingCompany(true); setCompanyMsg('')
    try {
      await setDoc(doc(db, 'organization_data', orgId), {
        companyName: companyName.trim(), companyAddress: companyAddress.trim(),
        companyPhone: companyPhone.trim(), companyLicense: companyLicense.trim(),
        defaultTaxState, googleReviewUrl: googleReviewUrl.trim(),
      }, { merge: true })
      setCompanyMsg('ok')
    } catch { setCompanyMsg('err') }
    finally { setSavingCompany(false); setTimeout(() => setCompanyMsg(''), 3000) }
  }

  // ── Profile handler ───────────────────────────────────────────────────────

  const saveTech = async (e) => {
    e.preventDefault()
    if (!orgId) return
    setSavingTech(true); setTechMsg('')
    try {
      await setDoc(doc(db, 'organization_data', orgId, 'contractors', user.uid),
        { displayName: techName.trim(), phone: techPhone.trim(), contactEmail: contactEmail.trim() },
        { merge: true })
      setTechMsg('ok')
    } catch { setTechMsg('err') }
    finally { setSavingTech(false); setTimeout(() => setTechMsg(''), 3000) }
  }

  // ── Password handler ──────────────────────────────────────────────────────

  const savePassword = async (e) => {
    e.preventDefault()
    setPwMsg(''); setPwErr('')
    if (newPw !== confirmPw) { setPwErr('New passwords do not match.'); return }
    if (newPw.length < 8)   { setPwErr('Password must be at least 8 characters.'); return }
    setSavingPw(true)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPw))
      await updatePassword(user, newPw)
      setPwMsg('ok'); setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err) {
      setPwErr(err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message)
    } finally { setSavingPw(false) }
  }

  // ── Team handlers ─────────────────────────────────────────────────────────

  const orgDomain   = user?.email?.split('@')[1]
  const isExternal  = (email) => email.trim().split('@')[1] !== orgDomain
  const emailValid  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())

  const closeInviteModal = () => {
    setShowInviteModal(false); setInviteEmail(''); setInviteRole('project_manager'); setInviteError('')
  }

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !emailValid) { setInviteError('Enter a valid email address.'); return }
    if (members.some(m => m.email === email)) { setInviteError('This person is already a team member.'); return }
    if (invites.some(i => i.email === email)) { setInviteError('A pending invite already exists for this email.'); return }
    setInviting(true); setInviteError('')
    try {
      const external = isExternal(email)
      const inviteRef = await addDoc(collection(db, 'organization_data', orgId, 'invites'), {
        email, role: inviteRole, isExternal: external,
        invitedAt: serverTimestamp(), invitedBy: user.uid,
      })
      await setDoc(doc(db, 'user_invites', encodeEmail(email)), {
        orgId, role: inviteRole, isExternal: external, invitedAt: serverTimestamp(),
      })
      setInvites(prev => [{ id: inviteRef.id, email, role: inviteRole, isExternal: external }, ...prev])
      closeInviteModal()
    } catch { setInviteError('Failed to send invite. Please try again.') }
    finally { setInviting(false) }
  }

  const cancelInvite = async (invite) => {
    setCancelingId(invite.id)
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'invites', invite.id))
      await deleteDoc(doc(db, 'user_invites', encodeEmail(invite.email))).catch(() => {})
      setInvites(prev => prev.filter(i => i.id !== invite.id))
    } finally { setCancelingId(null) }
  }

  const updateRole = async (member, newRole) => {
    setSavingId(member.id)
    try {
      const mref = doc(db, 'organization_data', orgId, 'contractors', member.id)
      const update = { role: newRole }
      if (newRole === 'admin') update.assignedClients = []
      await setDoc(mref, update, { merge: true })
      setMembers(prev => prev.map(m =>
        m.id === member.id ? { ...m, role: newRole, ...(newRole === 'admin' ? { assignedClients: [] } : {}) } : m
      ))
    } finally { setSavingId(null) }
  }

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.displayName || member.email} from the team?`)) return
    setRemovingId(member.id)
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'contractors', member.id))
      await setDoc(doc(db, 'users', member.id), { organizationId: null, pending: true }, { merge: true }).catch(() => {})
      setMembers(prev => prev.filter(m => m.id !== member.id))
    } finally { setRemovingId(null) }
  }

  const openAssignModal = (member) => {
    setAssignDraft(member.assignedClients || []); setAssignSearch(''); setAssignModal(member)
  }
  const toggleAssign = (phone) => setAssignDraft(prev =>
    prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]
  )
  const saveAssignments = async () => {
    if (!assignModal) return
    setAssignSaving(true)
    try {
      await setDoc(doc(db, 'organization_data', orgId, 'contractors', assignModal.id), { assignedClients: assignDraft }, { merge: true })
      setMembers(prev => prev.map(m => m.id === assignModal.id ? { ...m, assignedClients: assignDraft } : m))
      setAssignModal(null)
    } finally { setAssignSaving(false) }
  }

  // ── Integration handlers ──────────────────────────────────────────────────

  async function handleDriveConnect() {
    if (!orgId) return
    const backendUrl = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5001' : '/api/backend')
    window.open(`${backendUrl}/integrations/google-drive/auth?orgId=${orgId}`, 'google-drive-auth', 'width=520,height=640,left=200,top=100')
    let attempts = 0
    const interval = setInterval(async () => {
      if (++attempts > 80) { clearInterval(interval); return }
      try {
        const status = await api.drive.status(orgId)
        if (status?.connected) { clearInterval(interval); setDriveStatus(status) }
      } catch {}
    }, 1500)
  }

  async function handleDriveDisconnect() {
    setDisconnecting(true)
    await api.drive.disconnect({ orgId }).catch(() => {})
    setDriveStatus({ connected: false })
    setDisconnecting(false)
  }

  async function handleSaveCcKey(e) {
    e.preventDefault()
    if (!orgId) return
    setCcSaving(true); setCcMessage('')
    try {
      await setDoc(doc(db, 'organization_data', orgId), { companyCamAPI: ccApiInput.trim() }, { merge: true })
      setCcApiKey(ccApiInput.trim()); setCcEditing(false)
      setCcMessage('API key saved successfully.')
    } catch { setCcMessage('Failed to save. Please try again.') }
    finally { setCcSaving(false) }
  }

  async function handleRemoveCcKey() {
    if (!orgId) return
    setCcSaving(true)
    try {
      await setDoc(doc(db, 'organization_data', orgId), { companyCamAPI: '' }, { merge: true })
      setCcApiKey(''); setCcEditing(false); setCcMessage('')
    } catch { setCcMessage('Failed to remove. Please try again.') }
    finally { setCcSaving(false) }
  }

  // ── Template handlers ─────────────────────────────────────────────────────

  const deleteTemplate = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return
    setDeletingTplId(tpl.id)
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'signTemplates', tpl.id))
      setTemplates(prev => prev.filter(t => t.id !== tpl.id))
    } finally { setDeletingTplId(null) }
  }


  // ── Data cleanup handlers ─────────────────────────────────────────────────

  async function searchCleanup() {
    if (!orgId || !cleanupName.trim()) return
    setCleanupSearching(true); setCleanupResults(null); setCleanupDone(false)
    try {
      const name = cleanupName.trim()
      const [settSnap, invSnap] = await Promise.all([
        getDocs(query(collection(db, 'organization_data', orgId, 'settlement_summary'), where('clientName', '==', name))),
        getDocs(query(collection(db, 'organization_data', orgId, 'invoice_summary'),    where('clientName', '==', name))),
      ])
      const docs = [
        ...settSnap.docs.map(d => ({ ref: d.ref, col: 'settlement_summary', id: d.id, data: d.data() })),
        ...invSnap.docs.map(d => ({ ref: d.ref, col: 'invoice_summary',    id: d.id, data: d.data() })),
      ]
      setCleanupResults({ count: docs.length, docs })
    } finally { setCleanupSearching(false) }
  }

  async function deleteCleanup() {
    if (!cleanupResults?.docs?.length) return
    setCleanupDeleting(true)
    try {
      const deletes = []
      cleanupResults.docs.forEach(d => {
        deletes.push(deleteDoc(d.ref).catch(() => {}))
        if (d.col === 'invoice_summary') {
          const { clientUid, clientDocId: cDocId } = d.data || {}
          if (clientUid) deletes.push(deleteDoc(doc(db, 'users', clientUid, 'invoices', d.id)).catch(() => {}))
          if (cDocId)    deletes.push(deleteDoc(doc(db, 'organization_data', orgId, 'clients', cDocId, 'invoices', d.id)).catch(() => {}))
        }
      })
      await Promise.all(deletes)
      setCleanupResults(null); setCleanupName(''); setCleanupDone(true)
    } finally { setCleanupDeleting(false) }
  }

  async function scanOrphans() {
    if (!orgId) return
    setOrphanScanning(true); setOrphanResults(null); setOrphanDone(false)
    try {
      const summarySnap = await getDocs(collection(db, 'organization_data', orgId, 'invoice_summary'))
      const orphans = []
      await Promise.all(summarySnap.docs.map(async d => {
        const data = d.data(); let exists = false
        const checks = []
        if (data.clientUid)   checks.push(getDoc(doc(db, 'users', data.clientUid, 'invoices', d.id)).then(s => { if (s.exists()) exists = true }))
        if (data.clientDocId) checks.push(getDoc(doc(db, 'organization_data', orgId, 'clients', data.clientDocId, 'invoices', d.id)).then(s => { if (s.exists()) exists = true }))
        await Promise.all(checks)
        if (!exists) orphans.push({ ref: d.ref, id: d.id, clientName: data.clientName || '—', total: data.total || 0, issueDate: data.issueDate || '', clientUid: data.clientUid || null, clientDocId: data.clientDocId || null })
      }))
      orphans.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''))
      setOrphanResults({ count: orphans.length, docs: orphans })
    } finally { setOrphanScanning(false) }
  }

  async function deleteOrphans() {
    if (!orphanResults?.docs?.length) return
    setOrphanDeleting(true)
    try {
      const deletes = []
      orphanResults.docs.forEach(d => {
        deletes.push(deleteDoc(d.ref).catch(() => {}))
        if (d.clientUid)   deletes.push(deleteDoc(doc(db, 'users', d.clientUid, 'invoices', d.id)).catch(() => {}))
        if (d.clientDocId) deletes.push(deleteDoc(doc(db, 'organization_data', orgId, 'clients', d.clientDocId, 'invoices', d.id)).catch(() => {}))
      })
      await Promise.all(deletes)
      setOrphanResults(null); setOrphanDone(true)
    } finally { setOrphanDeleting(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="st-root">
      <div className="st-main">

        <div className="st-page-header">
          <h1 className="st-title">Settings</h1>
        </div>

        {/* Tab bar */}
        <div className="st-tab-bar">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`st-tab-btn${activeTab === tab ? ' st-tab-btn--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="ts-loading"><div className="ts-spinner" /></div>
        ) : (
          <>
            {/* ── Company ───────────────────────────────────────────────── */}
            {activeTab === 'Company' && (
              <div className="st-card">
                <div className="st-card-header">
                  <div className="st-card-icon st-card-icon--blue"><BuildingIcon /></div>
                  <div>
                    <p className="st-card-title">Company</p>
                    <p className="st-card-hint">Displayed on the client portal and invoices.</p>
                  </div>
                </div>
                <div className="st-card-body">
                  <form className="st-form" onSubmit={saveCompany}>
                    <div className="st-field">
                      <label className="st-label">Company Logo</label>
                      <div className="st-logo-row">
                        {companyLogoUrl
                          ? <img src={companyLogoUrl} alt="Company logo" className="st-logo-preview" />
                          : <div className="st-logo-placeholder">{companyName ? companyName[0].toUpperCase() : 'L'}</div>
                        }
                        <div className="st-logo-actions">
                          <button type="button" className="st-btn st-btn--secondary"
                            onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                            {uploadingLogo ? 'Uploading…' : companyLogoUrl ? 'Replace Logo' : 'Upload Logo'}
                          </button>
                          {companyLogoUrl && (
                            <button type="button" className="st-btn st-btn--ghost"
                              onClick={async () => { setCompanyLogoUrl(''); await setDoc(doc(db, 'organization_data', orgId), { companyLogoUrl: '' }, { merge: true }) }}>
                              Remove
                            </button>
                          )}
                        </div>
                        <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                      </div>
                      <span className="st-hint">Used on invoices and estimates. PNG or SVG recommended.</span>
                    </div>
                    <div className="st-field">
                      <label className="st-label">Company Name</label>
                      <input className="st-input" type="text" value={companyName}
                        onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Ukrainian Restoration LLC" required />
                    </div>
                    <div className="st-field">
                      <label className="st-label">Company Address</label>
                      <input className="st-input" type="text" value={companyAddress}
                        onChange={e => {
                          setCompanyAddress(e.target.value)
                          if (!defaultTaxState) { const d = detectStateFromAddress(e.target.value); if (d) setDefaultTaxState(d) }
                        }} placeholder="e.g. 123 Main St, Newark, NJ 07101" />
                    </div>
                    <div className="st-field">
                      <label className="st-label">Default Tax State</label>
                      <select className="st-input" value={defaultTaxState} onChange={e => setDefaultTaxState(e.target.value)}>
                        <option value="">— No default tax —</option>
                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <span className="st-hint">Auto-fills tax state on new invoices.</span>
                    </div>
                    <div className="st-field">
                      <label className="st-label">Company Phone</label>
                      <input className="st-input" type="tel" value={companyPhone}
                        onChange={e => setCompanyPhone(e.target.value)} placeholder="e.g. (312) 555-0100" />
                    </div>
                    <div className="st-field">
                      <label className="st-label">License Number</label>
                      <input className="st-input" type="text" value={companyLicense}
                        onChange={e => setCompanyLicense(e.target.value)} placeholder="e.g. IL-GC-123456" />
                      <span className="st-hint">Displayed on invoices and estimates.</span>
                    </div>
                    <div className="st-field">
                      <label className="st-label">Google Review Link</label>
                      <input className="st-input" type="url" value={googleReviewUrl}
                        onChange={e => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" />
                      <span className="st-hint">Included in the "Request Google review" SMS sent from a client's page.</span>
                    </div>
                    <div className="st-actions">
                      <button className="st-btn st-btn--primary" type="submit" disabled={savingCompany || !orgId}>
                        {savingCompany ? 'Saving…' : 'Save'}
                      </button>
                      {companyMsg === 'ok'              && <span className="st-msg st-msg--ok">Saved.</span>}
                      {companyMsg === 'ok-logo'         && <span className="st-msg st-msg--ok">Logo uploaded.</span>}
                      {companyMsg === 'err'             && <span className="st-msg st-msg--err">Could not save. Try again.</span>}
                      {companyMsg === 'err-logo'        && <span className="st-msg st-msg--err">Please upload an image file.</span>}
                      {companyMsg === 'err-logo-upload' && <span className="st-msg st-msg--err">Upload failed.</span>}
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* ── My Profile ────────────────────────────────────────────── */}
            {activeTab === 'My Profile' && (
              <div className="st-card">
                <div className="st-card-header">
                  <div className="st-card-icon st-card-icon--purple"><PersonIcon /></div>
                  <div>
                    <p className="st-card-title">My Profile</p>
                    <p className="st-card-hint">Your contact details shown to clients on the project portal.</p>
                  </div>
                </div>
                <div className="st-card-body">
                  <form className="st-form" onSubmit={saveTech}>
                    <div className="st-field">
                      <label className="st-label">Display Name</label>
                      <input className="st-input" type="text" value={techName}
                        onChange={e => setTechName(e.target.value)} placeholder="e.g. John Smith" />
                    </div>
                    <div className="st-field">
                      <label className="st-label">Contact Phone</label>
                      <input className="st-input" type="tel" value={techPhone}
                        onChange={e => setTechPhone(e.target.value)} placeholder="(555) 000-0000" />
                    </div>
                    <div className="st-field">
                      <label className="st-label">Contact Email</label>
                      <input className="st-input" type="email" value={contactEmail}
                        onChange={e => setContactEmail(e.target.value)} placeholder="you@example.com" />
                      <span className="st-hint">Optional — if different from your login email.</span>
                    </div>
                    <div className="st-actions">
                      <button className="st-btn st-btn--primary" type="submit" disabled={savingTech || !orgId}>
                        {savingTech ? 'Saving…' : 'Save Profile'}
                      </button>
                      {techMsg === 'ok'  && <span className="st-msg st-msg--ok">Saved.</span>}
                      {techMsg === 'err' && <span className="st-msg st-msg--err">Could not save. Try again.</span>}
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* ── Account ───────────────────────────────────────────────── */}
            {activeTab === 'Account' && (
              <>
                <div className="st-card">
                  <div className="st-card-header">
                    <div className="st-card-icon st-card-icon--slate">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                      </svg>
                    </div>
                    <div>
                      <p className="st-card-title">Account</p>
                      <p className="st-card-hint">Your login information.</p>
                    </div>
                  </div>
                  <div className="st-card-body">
                    <div className="st-info-row">
                      <span className="st-info-label">Email</span>
                      <span>{user?.email}</span>
                    </div>
                    <div className="st-info-row">
                      <span className="st-info-label">Role</span>
                      <span style={{ textTransform: 'capitalize' }}>{(role || 'admin').replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>

                {user?.email && (
                  <div className="st-card">
                    <div className="st-card-header">
                      <div className="st-card-icon st-card-icon--amber"><LockIcon /></div>
                      <div>
                        <p className="st-card-title">Change Password</p>
                        <p className="st-card-hint">Must be at least 8 characters.</p>
                      </div>
                    </div>
                    <div className="st-card-body">
                      <form className="st-form" onSubmit={savePassword}>
                        <div className="st-field">
                          <label className="st-label">Current Password</label>
                          <input className="st-input" type="password" value={currentPw}
                            onChange={e => setCurrentPw(e.target.value)} required />
                        </div>
                        <div className="st-field">
                          <label className="st-label">New Password</label>
                          <input className="st-input" type="password" value={newPw}
                            onChange={e => setNewPw(e.target.value)} minLength={8} required />
                        </div>
                        <div className="st-field">
                          <label className="st-label">Confirm New Password</label>
                          <input className="st-input" type="password" value={confirmPw}
                            onChange={e => setConfirmPw(e.target.value)} required />
                        </div>
                        <div className="st-actions">
                          <button className="st-btn st-btn--primary" type="submit" disabled={savingPw}>
                            {savingPw ? 'Updating…' : 'Update Password'}
                          </button>
                          {pwMsg === 'ok' && <span className="st-msg st-msg--ok">Password updated.</span>}
                          {pwErr          && <span className="st-msg st-msg--err">{pwErr}</span>}
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Team ──────────────────────────────────────────────────── */}
            {activeTab === 'Team' && (
              <div className="ts-section">
                <div className="ts-section-header">
                  <div className="ts-section-header-row">
                    <div>
                      <h2 className="ts-section-title">
                        <TeamIcon /> Team Members
                        <span className="ts-member-count">{members.length + invites.length}</span>
                      </h2>
                      <p className="ts-section-hint">Active members and pending invites.</p>
                    </div>
                    <button className="ts-invite-btn" onClick={() => setShowInviteModal(true)}>
                      <PlusIcon /> Invite Member
                    </button>
                  </div>
                </div>

                <div className="ts-member-list">
                  {members.map(member => {
                    const isYou      = member.id === user?.uid
                    const mRole      = member.role || 'admin'
                    const isSaving   = savingId   === member.id
                    const isRemoving = removingId === member.id
                    const assignedCount = (member.assignedClients || []).length
                    return (
                      <div key={member.id} className={`ts-member-card${isYou ? ' ts-member-you' : ''}`}>
                        <div className="ts-member-avatar">
                          {(member.displayName || member.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="ts-member-info">
                          <div className="ts-member-name">
                            {member.displayName || <span className="ts-muted">No name</span>}
                            {isYou && <span className="ts-you-badge">You</span>}
                          </div>
                          <div className="ts-member-email">{member.email || '—'}</div>
                          <div className="ts-member-meta">
                            Last login: {fmtDate(member.lastLogin)}
                            {(mRole === 'project_manager' || mRole === 'public_adjuster') && (
                              <span className="ts-assigned-hint">
                                &nbsp;· {assignedCount} client{assignedCount !== 1 ? 's' : ''} assigned
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ts-member-actions">
                          <select className={`ts-role-select ts-role-${mRole}`} value={mRole}
                            disabled={isYou || isSaving} onChange={e => updateRole(member, e.target.value)}>
                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          {(mRole === 'project_manager' || mRole === 'public_adjuster') && !isYou && (
                            <button className="ts-assign-btn" onClick={() => openAssignModal(member)} disabled={isSaving}>
                              <ClientsIcon /> Manage Clients
                            </button>
                          )}
                          {!isYou && (
                            <button className="ts-remove-btn" onClick={() => removeMember(member)} disabled={isRemoving || isSaving} title="Remove from team">
                              {isRemoving ? <SpinnerInline /> : <TrashIcon />}
                            </button>
                          )}
                          {isSaving && <SpinnerInline />}
                        </div>
                      </div>
                    )
                  })}

                  {invites.map(invite => (
                    <div key={invite.id} className="ts-member-card ts-member-invited">
                      <div className="ts-member-avatar ts-avatar-invited">
                        {invite.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="ts-member-info">
                        <div className="ts-member-name">
                          {invite.email}
                          <span className="ts-invited-badge">Invited</span>
                          {invite.isExternal && <span className="ts-external-badge">External</span>}
                        </div>
                        <div className="ts-member-meta">
                          Pending · {ROLES.find(r => r.value === invite.role)?.label}
                        </div>
                      </div>
                      <div className="ts-member-actions">
                        <button className="ts-remove-btn" onClick={() => cancelInvite(invite)} disabled={cancelingId === invite.id} title="Cancel invite">
                          {cancelingId === invite.id ? <SpinnerInline /> : <TrashIcon />}
                        </button>
                      </div>
                    </div>
                  ))}

                  {members.length === 0 && invites.length === 0 && (
                    <p className="ts-empty">No team members yet. Invite someone to get started.</p>
                  )}
                </div>

                <div className="ts-legend">
                  <div className="ts-legend-item">
                    <span className="ts-role-badge ts-role-admin-badge">Admin</span>
                    <span>Full access · manage team · see all clients</span>
                  </div>
                  <div className="ts-legend-item">
                    <span className="ts-role-badge ts-role-pm-badge">Project Manager</span>
                    <span>Access limited to assigned clients · no team settings</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Integrations ──────────────────────────────────────────── */}
            {activeTab === 'Integrations' && (
              <div className="mc-section">
                <div className="mc-integration-card">
                  <div className="mc-integration-card__logo">
                    <svg width="28" height="28" viewBox="0 0 87.3 78" fill="none">
                      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 52H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                      <path d="M43.65 25L29.9 0c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 000 52h27.5z" fill="#00AC47"/>
                      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 56.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#EA4335"/>
                      <path d="M43.65 25L57.4 0c-1.35-.8-3.45-1.2-4.65-1.2H34.9c-1.2 0-3.1.4-4.65 1.2z" fill="#00832D"/>
                      <path d="M59.8 52H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h49.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC"/>
                      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 52h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
                    </svg>
                  </div>
                  <div className="mc-integration-card__info">
                    <h3>Google Drive</h3>
                    <p>Auto-sync claim documents and photos to organized Drive folders per client.</p>
                  </div>
                  <div className="mc-integration-card__action">
                    {driveLoading ? (
                      <span className="mc-muted">Checking…</span>
                    ) : driveStatus?.connected ? (
                      <>
                        <span className="mc-badge mc-badge--green">Connected</span>
                        <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={handleDriveDisconnect} disabled={disconnecting}>
                          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </>
                    ) : (
                      <button className="mc-btn mc-btn--primary" onClick={handleDriveConnect} disabled={!orgId}>Connect Drive</button>
                    )}
                  </div>
                </div>

                <div className="mc-integration-card" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div className="mc-integration-card__logo" style={{ paddingTop: 4 }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </div>
                  <div className="mc-integration-card__info">
                    <h3>CompanyCam</h3>
                    <p>Link jobsite photo projects to client claims and control which photos homeowners see.</p>
                  </div>
                  <div className="mc-integration-card__action">
                    {ccLoading ? (
                      <span className="mc-muted">Checking…</span>
                    ) : ccApiKey && !ccEditing ? (
                      <>
                        <span className="mc-badge mc-badge--green">Connected</span>
                        <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => { setCcApiInput(ccApiKey); setCcEditing(true); setCcMessage('') }}>Edit Key</button>
                        <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={handleRemoveCcKey} disabled={ccSaving}>Remove</button>
                      </>
                    ) : !ccEditing ? (
                      <button className="mc-btn mc-btn--primary" onClick={() => { setCcEditing(true); setCcApiInput('') }}>Connect</button>
                    ) : null}
                  </div>
                  {ccEditing && (
                    <form onSubmit={handleSaveCcKey} style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                      <input type="password" placeholder="Paste CompanyCam API key…" value={ccApiInput}
                        onChange={e => setCcApiInput(e.target.value)} className="mc-input" style={{ flex: 1, minWidth: 0 }} autoFocus />
                      <button type="submit" className="mc-btn mc-btn--primary" disabled={ccSaving || !ccApiInput.trim()}>
                        {ccSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => { setCcEditing(false); setCcApiInput(''); setCcMessage('') }}>Cancel</button>
                    </form>
                  )}
                  {ccMessage && (
                    <p style={{ width: '100%', margin: '8px 0 0', fontSize: 13, color: ccMessage.includes('Failed') ? '#dc2626' : '#16a34a' }}>
                      {ccMessage}
                    </p>
                  )}
                </div>

                <div className="mc-integration-card mc-integration-card--disabled">
                  <div className="mc-integration-card__logo">✉️</div>
                  <div className="mc-integration-card__info">
                    <h3>SMS Notifications</h3>
                    <p>Send automated claim status updates to clients via text message.</p>
                  </div>
                  <div className="mc-integration-card__action">
                    <span className="mc-badge">Coming soon</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Templates ─────────────────────────────────────────────── */}
            {activeTab === 'Templates' && (
              <div className="ts-section">
                <div className="ts-section-header">
                  <div className="ts-section-header-row">
                    <div>
                      <h2 className="ts-section-title">
                        Document Templates
                        <span className="ts-member-count">{templates.length}</span>
                      </h2>
                      <p className="ts-section-hint">PDF templates with client and contractor signature fields.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input ref={tplFileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) { setBuilderFile(f); setEditingTemplate(null); setShowTplBuilder(true) }
                          e.target.value = ''
                        }} />
                      <button className="ts-invite-btn" onClick={() => tplFileRef.current?.click()}>
                        <PlusIcon /> New Template
                      </button>
                    </div>
                  </div>
                </div>
                {templatesLoading ? (
                  <div className="ts-loading"><div className="ts-spinner" /></div>
                ) : templates.length === 0 ? (
                  <p className="ts-empty" style={{ padding: '20px 24px' }}>
                    No templates yet. Click "New Template" to upload a PDF and place signature fields.
                  </p>
                ) : (
                  <div className="ts-member-list">
                    {templates.map(tpl => {
                      const clientFields     = (tpl.fields || []).filter(f => !f.signer || f.signer === 'client')
                      const contractorFields = (tpl.fields || []).filter(f => f.signer === 'contractor')
                      const isDeletingThis   = deletingTplId === tpl.id
                      return (
                        <div key={tpl.id} className="ts-member-card">
                          <div className="ts-member-avatar" style={{ background: '#2563eb', color: '#fff', fontSize: 16 }}>✍</div>
                          <div className="ts-member-info">
                            <div className="ts-member-name">{tpl.name}</div>
                            <div className="ts-member-meta">
                              {clientFields.length} client field{clientFields.length !== 1 ? 's' : ''}
                              {contractorFields.length > 0 && ` · ${contractorFields.length} contractor field${contractorFields.length !== 1 ? 's' : ''}`}
                            </div>
                          </div>
                          <div className="ts-member-actions">
                            <button className="ts-assign-btn" onClick={() => { setEditingTemplate(tpl); setBuilderFile(null); setShowTplBuilder(true) }}>Edit</button>
                            <button className="ts-remove-btn" onClick={() => deleteTemplate(tpl)} disabled={isDeletingThis} title="Delete template">
                              {isDeletingThis ? <SpinnerInline /> : <TrashIcon />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Data ──────────────────────────────────────────────────── */}
            {activeTab === 'Data' && (
              <>
                <div className="ts-section" style={{ border: '1.5px solid #fecaca', marginBottom: 20 }}>
                  <div className="ts-section-header" style={{ borderBottom: '1px solid #fecaca', background: '#fff5f5' }}>
                    <div className="ts-section-header-row">
                      <div>
                        <h2 className="ts-section-title" style={{ color: '#991b1b' }}>Scan for Deleted Invoices</h2>
                        <p className="ts-section-hint">Finds invoice_summary entries whose source invoice no longer exists.</p>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <button className="ts-btn ts-btn--primary" onClick={scanOrphans} disabled={orphanScanning} style={{ minWidth: 160, alignSelf: 'flex-start' }}>
                      {orphanScanning ? 'Scanning…' : '🔍 Scan Now'}
                    </button>
                    {orphanDone && <p style={{ fontSize: 13, color: '#15803d', fontWeight: 600, margin: 0 }}>✓ Orphaned invoice records removed from the Sales Report.</p>}
                    {orphanResults && (
                      orphanResults.count === 0 ? (
                        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>✓ No orphaned invoice records found — the report is clean.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <p style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, margin: 0 }}>
                            Found {orphanResults.count} orphaned invoice record{orphanResults.count !== 1 ? 's' : ''}:
                          </p>
                          <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 8, overflow: 'hidden' }}>
                            {orphanResults.docs.map(d => (
                              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #fef2f2', fontSize: 13 }}>
                                <span style={{ fontWeight: 600, color: '#0f172a' }}>{d.clientName}</span>
                                <span style={{ color: '#64748b' }}>{d.issueDate || '—'}</span>
                                <span style={{ color: '#dc2626', fontWeight: 700 }}>{(d.total || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
                              </div>
                            ))}
                          </div>
                          <button className="ts-btn" onClick={deleteOrphans} disabled={orphanDeleting}
                            style={{ background: '#dc2626', color: '#fff', border: 'none', alignSelf: 'flex-start' }}>
                            {orphanDeleting ? 'Removing…' : `Remove All ${orphanResults.count} from Report`}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="ts-section" style={{ border: '1.5px solid #fecaca' }}>
                  <div className="ts-section-header" style={{ borderBottom: '1px solid #fecaca', background: '#fff5f5' }}>
                    <div className="ts-section-header-row">
                      <div>
                        <h2 className="ts-section-title" style={{ color: '#991b1b' }}>Remove Orphaned Records</h2>
                        <p className="ts-section-hint">Search by exact client name to find and delete lingering settlement or invoice records.</p>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input className="ts-input" style={{ flex: 1, minWidth: 220 }} placeholder="Client name"
                        value={cleanupName}
                        onChange={e => { setCleanupName(e.target.value); setCleanupResults(null); setCleanupDone(false) }}
                        onKeyDown={e => e.key === 'Enter' && searchCleanup()} />
                      <button className="ts-btn ts-btn--primary" onClick={searchCleanup} disabled={cleanupSearching || !cleanupName.trim()}>
                        {cleanupSearching ? 'Searching…' : 'Search'}
                      </button>
                    </div>
                    {cleanupDone && <p style={{ fontSize: 13, color: '#15803d', fontWeight: 600, margin: 0 }}>✓ All matching records deleted.</p>}
                    {cleanupResults && (
                      cleanupResults.count === 0 ? (
                        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No records found for that name.</p>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <p style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, margin: 0 }}>
                            Found {cleanupResults.count} record{cleanupResults.count !== 1 ? 's' : ''} — {cleanupResults.docs.filter(d => d.col === 'settlement_summary').length} settlement, {cleanupResults.docs.filter(d => d.col === 'invoice_summary').length} invoice.
                          </p>
                          <button className="ts-btn" onClick={deleteCleanup} disabled={cleanupDeleting}
                            style={{ background: '#dc2626', color: '#fff', border: 'none' }}>
                            {cleanupDeleting ? 'Deleting…' : `Delete All ${cleanupResults.count} Records`}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Template Builder overlay ── */}
      {showTplBuilder && (builderFile || editingTemplate) && (
        <TemplateBuilder
          pdfFile={builderFile || null}
          existingTemplate={editingTemplate || null}
          orgId={orgId}
          user={user}
          onSave={template => {
            setTemplates(prev => {
              const idx = prev.findIndex(t => t.id === template.id)
              if (idx >= 0) { const n = [...prev]; n[idx] = template; return n }
              return [template, ...prev]
            })
            setShowTplBuilder(false); setBuilderFile(null); setEditingTemplate(null)
          }}
          onClose={() => { setShowTplBuilder(false); setBuilderFile(null); setEditingTemplate(null) }}
        />
      )}

      {/* ── Assign Clients Modal ── */}
      {assignModal && (() => {
        const q = assignSearch.toLowerCase()
        const visibleClients = clients.filter(c =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q) ||
          (c.address || '').toLowerCase().includes(q)
        )
        const allVisibleSelected = visibleClients.length > 0 && visibleClients.every(c => assignDraft.includes(c.phone))
        return (
          <>
            <div className="ts-overlay" onClick={() => setAssignModal(null)} />
            <div className="ts-modal ts-assign-modal">
              <div className="ts-modal-header">
                <h2>Manage Client Access</h2>
                <p className="ts-modal-sub">
                  <strong>{assignModal.displayName || assignModal.email}</strong> — select which clients they can view
                </p>
              </div>
              <div className="ts-assign-toolbar">
                <div className="ts-assign-search-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input className="ts-assign-search" type="text" placeholder="Search clients…"
                    value={assignSearch} onChange={e => setAssignSearch(e.target.value)} autoFocus />
                  {assignSearch && <button className="ts-assign-search-clear" onClick={() => setAssignSearch('')}>✕</button>}
                </div>
                <button className="ts-select-all-btn" onClick={() => {
                  if (allVisibleSelected) {
                    setAssignDraft(prev => prev.filter(p => !visibleClients.some(c => c.phone === p)))
                  } else {
                    const toAdd = visibleClients.map(c => c.phone).filter(p => !assignDraft.includes(p))
                    setAssignDraft(prev => [...prev, ...toAdd])
                  }
                }}>
                  {allVisibleSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="ts-assign-summary">
                <span className="ts-assign-count">{assignDraft.length} client{assignDraft.length !== 1 ? 's' : ''} selected</span>
                {assignSearch && <span className="ts-assign-filter-hint">Showing {visibleClients.length} of {clients.length}</span>}
              </div>
              <div className="ts-client-list">
                {visibleClients.map(client => {
                  const checked  = assignDraft.includes(client.phone)
                  const isClosed = client.claimStatus === 'closed'
                  const label    = client.name || client.phone || '?'
                  return (
                    <label key={client.phone} className={`ts-client-row${checked ? ' ts-client-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAssign(client.phone)} className="ts-client-checkbox" />
                      <div className="ts-client-avatar">{label.charAt(0).toUpperCase()}</div>
                      <div className="ts-client-label">
                        <div className="ts-client-name-row">
                          <span className="ts-client-name">{client.name || <span className="ts-muted">No name</span>}</span>
                          <span className={`ts-client-status-badge ts-client-status-badge--${isClosed ? 'closed' : 'open'}`}>
                            {isClosed ? 'Closed' : 'Open'}
                          </span>
                        </div>
                        <span className="ts-client-phone">{formatPhone(client.phone)}</span>
                        {client.address && <span className="ts-client-address">{client.address}</span>}
                        {client.claimNumbers?.length > 0 && <span className="ts-client-claim">Claim: {client.claimNumbers.join(', ')}</span>}
                      </div>
                      {checked && <CheckIcon />}
                    </label>
                  )
                })}
                {visibleClients.length === 0 && (
                  <p className="ts-empty">{clients.length === 0 ? 'No clients in this organization yet.' : 'No clients match your search.'}</p>
                )}
              </div>
              <div className="ts-modal-actions">
                <button className="ts-btn-secondary" onClick={() => setAssignModal(null)}>Cancel</button>
                <button className="ts-btn-primary" onClick={saveAssignments} disabled={assignSaving}>
                  {assignSaving ? 'Saving…' : `Save (${assignDraft.length} selected)`}
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Invite Member Modal ── */}
      {showInviteModal && (
        <>
          <div className="ts-overlay" onClick={closeInviteModal} />
          <div className="ts-modal ts-invite-modal">
            <div className="ts-modal-header">
              <h2>Invite Team Member</h2>
              <p className="ts-modal-sub">They'll be auto-assigned to your organization when they first sign in.</p>
            </div>
            <div className="ts-invite-body">
              <label className="ts-invite-label">Email address</label>
              <input type="email" className="ts-invite-input" placeholder="name@example.com"
                value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteError('') }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()} autoFocus />
              <label className="ts-invite-label" style={{ marginTop: 18 }}>Permission level</label>
              <div className="ts-role-pills">
                {ROLES.map(r => (
                  <button key={r.value} type="button"
                    className={`ts-role-pill${inviteRole === r.value ? ' ts-role-pill--active' : ''}`}
                    onClick={() => setInviteRole(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
              {inviteEmail && emailValid && !inviteError && (
                <div className="ts-invite-preview">
                  <strong>{inviteEmail.trim()}</strong> will be invited as an{' '}
                  <strong>{isExternal(inviteEmail) ? 'external user' : 'internal team member'}</strong>{' '}
                  with <strong>{ROLES.find(r => r.value === inviteRole)?.label}</strong> access.
                </div>
              )}
              {inviteError && <p className="ts-invite-error">{inviteError}</p>}
            </div>
            <div className="ts-modal-actions">
              <button className="ts-btn-secondary" onClick={closeInviteModal}>Cancel</button>
              <button className="ts-btn-primary" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Icon components ───────────────────────────────────────────────────────────

const BuildingIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
  </svg>
)
const PersonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
)
const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)
const SpinnerInline = () => <div className="ts-spinner-inline" />
const TeamIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
)
const ClientsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
  </svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
)
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

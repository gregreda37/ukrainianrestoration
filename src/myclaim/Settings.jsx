import { useState, useEffect } from 'react'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from './useAuth'
import './Settings.css'

const API = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5000' : '/api/backend')

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
const DriveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.9 19.79 19.79 0 0 1 1.6 5.27 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)

export default function Settings() {
  const { user } = useAuth()

  const [role,           setRole]           = useState(null)
  const [orgId,          setOrgId]          = useState('')

  // Company
  const [companyName,    setCompanyName]    = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [savingCompany,  setSavingCompany]  = useState(false)
  const [companyMsg,     setCompanyMsg]     = useState('')

  // My Profile
  const [techName,      setTechName]      = useState('')
  const [techPhone,     setTechPhone]     = useState('')
  const [contactEmail,  setContactEmail]  = useState('')
  const [savingTech,    setSavingTech]    = useState(false)
  const [techMsg,       setTechMsg]       = useState('')

  // Password
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg,     setPwMsg]     = useState('')
  const [pwErr,     setPwErr]     = useState('')
  const [savingPw,  setSavingPw]  = useState(false)

  // Google Drive
  const [driveConnected,  setDriveConnected]  = useState(false)
  const [driveFolderName, setDriveFolderName] = useState('')
  const [driveLoading,    setDriveLoading]    = useState(false)
  const [driveError,      setDriveError]      = useState('')

  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid)).then(async snap => {
      const oid = snap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const [orgSnap, contractorSnap] = await Promise.all([
        getDoc(doc(db, 'organization_data', oid)),
        getDoc(doc(db, 'organization_data', oid, 'contractors', user.uid)),
      ])

      if (orgSnap.exists()) {
        setCompanyName(orgSnap.data().companyName || '')
        setCompanyAddress(orgSnap.data().companyAddress || '')
      }

      const cd = contractorSnap.exists() ? contractorSnap.data() : {}
      setRole(cd.role || 'admin')
      setTechName(cd.displayName || user.displayName || '')
      setTechPhone(cd.phone || '')
      setContactEmail(cd.contactEmail || '')

      fetch(`${API}/integrations/google-drive/status?orgId=${encodeURIComponent(oid)}`)
        .then(r => r.json())
        .then(d => { setDriveConnected(!!d.connected); setDriveFolderName(d.folderName || '') })
        .catch(() => {})
    })
  }, [user])

  useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.success) { setDriveConnected(true); setDriveFolderName(e.data.folderName || ''); setDriveError('') }
      else if (e.data.message) setDriveError(e.data.message)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const connectDrive = () => {
    if (!orgId) return
    const w = window.open(`${API}/integrations/google-drive/auth?orgId=${encodeURIComponent(orgId)}`, 'google-drive-auth', 'width=600,height=700,left=200,top=100')
    if (!w) setDriveError('Popup blocked — allow popups for this page.')
  }

  const disconnectDrive = async () => {
    if (!orgId) return
    setDriveLoading(true); setDriveError('')
    try {
      const r = await fetch(`${API}/integrations/google-drive/disconnect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (r.ok) { setDriveConnected(false); setDriveFolderName('') }
      else setDriveError('Disconnect failed.')
    } catch { setDriveError('Could not reach backend.') }
    finally { setDriveLoading(false) }
  }

  const saveCompany = async (e) => {
    e.preventDefault()
    if (!orgId) return
    setSavingCompany(true); setCompanyMsg('')
    try {
      await setDoc(doc(db, 'organization_data', orgId), { companyName: companyName.trim(), companyAddress: companyAddress.trim() }, { merge: true })
      setCompanyMsg('ok')
    } catch { setCompanyMsg('err') }
    finally { setSavingCompany(false); setTimeout(() => setCompanyMsg(''), 3000) }
  }

  const saveTech = async (e) => {
    e.preventDefault()
    if (!orgId) return
    setSavingTech(true); setTechMsg('')
    try {
      await setDoc(doc(db, 'organization_data', orgId, 'contractors', user.uid), { displayName: techName.trim(), phone: techPhone.trim(), contactEmail: contactEmail.trim() }, { merge: true })
      setTechMsg('ok')
    } catch { setTechMsg('err') }
    finally { setSavingTech(false); setTimeout(() => setTechMsg(''), 3000) }
  }

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

  const isAdmin = role === null || role === 'admin'

  return (
    <div className="st-root">
      <div className="st-main">

        {/* Page header */}
        <div className="st-page-header">
          <h1 className="st-title">Settings</h1>
          <p className="st-subtitle">Manage your profile, company info, and integrations.</p>
        </div>

        {/* ── Company (admins only) ── */}
        {isAdmin && (
          <div className="st-card">
            <div className="st-card-header">
              <div className="st-card-icon st-card-icon--blue"><BuildingIcon /></div>
              <div>
                <p className="st-card-title">Company</p>
                <p className="st-card-hint">Displayed on the client portal team card.</p>
              </div>
            </div>
            <div className="st-card-body">
              <form className="st-form" onSubmit={saveCompany}>
                <div className="st-field">
                  <label className="st-label">Company Name</label>
                  <input className="st-input" type="text" value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="e.g. Ukrainian Restoration LLC" required />
                </div>
                <div className="st-field">
                  <label className="st-label">Company Address</label>
                  <input className="st-input" type="text" value={companyAddress}
                    onChange={e => setCompanyAddress(e.target.value)}
                    placeholder="e.g. 123 Main St, Newark, NJ 07101" />
                </div>
                <div className="st-actions">
                  <button className="st-btn st-btn--primary" type="submit" disabled={savingCompany || !orgId}>
                    {savingCompany ? 'Saving…' : 'Save'}
                  </button>
                  {companyMsg === 'ok'  && <span className="st-msg st-msg--ok">Saved.</span>}
                  {companyMsg === 'err' && <span className="st-msg st-msg--err">Could not save. Try again.</span>}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── My Profile (all users) ── */}
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

        {/* ── Account ── */}
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

        {/* ── Change Password ── */}
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
                  {pwMsg === 'ok'  && <span className="st-msg st-msg--ok">Password updated.</span>}
                  {pwErr           && <span className="st-msg st-msg--err">{pwErr}</span>}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Google Drive (admin only) ── */}
        {isAdmin && (
          <div className="st-card">
            <div className="st-card-header">
              <div className="st-card-icon st-card-icon--green"><DriveIcon /></div>
              <div>
                <p className="st-card-title">Google Drive</p>
                <p className="st-card-hint">Auto-create folders for each client job.</p>
              </div>
            </div>
            <div className="st-card-body">
              <div className="st-drive-status">
                <span className={`st-status-dot ${driveConnected ? 'st-status-dot--on' : 'st-status-dot--off'}`} />
                <span>{driveConnected ? 'Connected' : 'Not connected'}</span>
              </div>
              {driveConnected && driveFolderName && (
                <div className="st-drive-folder">{driveFolderName}</div>
              )}
              {driveError && <p className="st-msg st-msg--err" style={{ marginTop: 10 }}>{driveError}</p>}
              <div className="st-actions" style={{ marginTop: 16 }}>
                {!driveConnected ? (
                  <button className="st-btn st-btn--primary" onClick={connectDrive} disabled={!orgId}>
                    Connect Google Drive
                  </button>
                ) : (
                  <button className="st-btn st-btn--danger" onClick={disconnectDrive} disabled={driveLoading}>
                    {driveLoading ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

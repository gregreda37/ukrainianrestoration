import { useState, useEffect } from 'react'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { auth, db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from './useAuth'

const API = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000'

export default function Settings() {
  const { user } = useAuth()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [orgId,          setOrgId]          = useState('')
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveFolderName, setDriveFolderName] = useState('')
  const [driveLoading,   setDriveLoading]   = useState(false)
  const [driveError,     setDriveError]     = useState('')

  // Load orgId then drive status
  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const oid = snap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)
      fetch(`${API}/integrations/google-drive/status?orgId=${encodeURIComponent(oid)}`)
        .then(r => r.json())
        .then(d => { setDriveConnected(!!d.connected); setDriveFolderName(d.folderName || '') })
        .catch(() => {})
    })
  }, [user])

  // Listen for the OAuth popup closing and reporting back
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.success) {
        setDriveConnected(true)
        setDriveFolderName(e.data.folderName || '')
        setDriveError('')
      } else if (e.data.message) {
        setDriveError(e.data.message)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const connectDrive = () => {
    if (!orgId) return
    const w = window.open(
      `${API}/integrations/google-drive/auth?orgId=${encodeURIComponent(orgId)}`,
      'google-drive-auth',
      'width=600,height=700,left=200,top=100'
    )
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

  async function handlePasswordChange(e) {
    e.preventDefault()
    setMsg('')
    setError('')
    if (newPw !== confirmPw) { setError('New passwords do not match.'); return }
    if (newPw.length < 8) { setError('Password must be at least 8 characters.'); return }
    setSaving(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPw)
      setMsg('Password updated successfully.')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (err) {
      setError(err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mc-page">
      <div className="mc-page__hd">
        <h1>Settings</h1>
      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">Account</h2>
        <div className="mc-setting-row">
          <span className="mc-setting-row__label">Email</span>
          <span>{user?.email}</span>
        </div>

      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">Change Password</h2>
        <form className="mc-form" onSubmit={handlePasswordChange}>
          <label className="mc-field">
            <span>Current Password</span>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
            />
          </label>
          <label className="mc-field">
            <span>New Password</span>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="mc-field">
            <span>Confirm New Password</span>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              required
            />
          </label>
          {error && <p className="mc-error">{error}</p>}
          {msg && <p className="mc-success">{msg}</p>}
          <button className="mc-btn mc-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">Google Drive</h2>
        <div className="mc-setting-row">
          <span className="mc-setting-row__label">Status</span>
          <span style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{
              width:8, height:8, borderRadius:'50%', display:'inline-block',
              background: driveConnected ? '#16a34a' : '#d1d5db'
            }} />
            {driveConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {driveConnected && driveFolderName && (
          <div className="mc-setting-row">
            <span className="mc-setting-row__label">Root folder</span>
            <span className="mc-muted mc-mono">{driveFolderName}</span>
          </div>
        )}
        {driveError && <p className="mc-error" style={{ marginTop:8 }}>{driveError}</p>}
        <div style={{ marginTop:12, display:'flex', gap:8 }}>
          {!driveConnected ? (
            <button className="mc-btn mc-btn--primary" onClick={connectDrive} disabled={!orgId}>
              Connect Google Drive
            </button>
          ) : (
            <button className="mc-btn" onClick={disconnectDrive} disabled={driveLoading}
              style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5' }}>
              {driveLoading ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      </div>

      <div className="mc-section">
        <h2 className="mc-section__title">Backend</h2>
        <div className="mc-setting-row">
          <span className="mc-setting-row__label">API URL</span>
          <span className="mc-muted mc-mono">{import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000'}</span>
        </div>
      </div>
    </div>
  )
}

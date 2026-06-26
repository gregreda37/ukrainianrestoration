import { useEffect, useState, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from './useAuth'

const encodeEmail = (email) =>
  email.toLowerCase().replace(/\./g, '__dot__').replace(/@/g, '__at__')

export default function PendingApproval() {
  const { user, loading, pending } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [message, setMessage] = useState('')

  const claimInvite = useCallback(async () => {
    if (!user?.email) return
    setChecking(true)
    setMessage('')
    try {
      const encoded = encodeEmail(user.email)
      const inviteSnap = await getDoc(doc(db, 'user_invites', encoded))

      if (inviteSnap.exists()) {
        const { orgId: inviteOrgId, role: inviteRole } = inviteSnap.data()

        await setDoc(doc(db, 'users', user.uid), {
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          organizationId: inviteOrgId,
          pending: false,
          role: 'contractor',
          updatedAt: serverTimestamp(),
        }, { merge: true })

        await setDoc(doc(db, 'organization_data', inviteOrgId, 'contractors', user.uid), {
          email: user.email,
          displayName: user.displayName || '',
          role: inviteRole || 'project_manager',
          joinedAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        }, { merge: true })

        await deleteDoc(doc(db, 'user_invites', encoded)).catch(() => {})

        const orgInvites = await getDocs(
          query(collection(db, 'organization_data', inviteOrgId, 'invites'), where('email', '==', user.email.toLowerCase()))
        ).catch(() => ({ docs: [] }))
        for (const d of orgInvites.docs) await deleteDoc(d.ref).catch(() => {})

        // Hard redirect so useAuth re-reads the now-updated user doc from scratch
        window.location.replace('/myclaim')
      } else {
        setMessage("No invitation found. Ask your contractor to add your email address to their team.")
      }
    } catch {
      setMessage('Something went wrong checking your invite. Please try again.')
    } finally {
      setChecking(false)
      setChecked(true)
    }
  }, [user])

  // Auto-check on mount once the user is known
  useEffect(() => {
    if (user && !loading && !checked) claimInvite()
  }, [user, loading, checked, claimInvite])

  // Not logged in — send to login
  if (!loading && !user) return <Navigate to="/myclaim/login" replace />

  // Already has a real org — send to dashboard
  if (!loading && !pending && user && !user.phoneNumber) return <Navigate to="/myclaim" replace />

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      padding: 24,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '48px 40px',
        maxWidth: 420,
        width: '100%',
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64,
          borderRadius: '50%',
          background: '#eff6ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
          Waiting for access
        </h1>

        <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 24px', lineHeight: 1.6 }}>
          {checking
            ? 'Checking for your invitation…'
            : message || 'Your account has been created. Ask your contractor to add your email to their team.'}
        </p>

        {checking && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <div className="mc-spinner" />
          </div>
        )}

        {checked && !checking && (
          <button
            className="mc-btn-pill"
            onClick={claimInvite}
            disabled={checking}
            style={{ marginBottom: 16 }}
          >
            Check Again
          </button>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            style={{
              background: 'none', border: 'none',
              color: '#94a3b8', cursor: 'pointer',
              fontSize: 13, padding: '8px 0',
            }}
            onClick={() => signOut(auth)}
          >
            Sign out
          </button>
        </div>

        <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 16 }}>
          Signed in as {user?.email}
        </p>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'

export function useAuth() {
  const [user,      setUser]      = useState(undefined) // undefined = still initializing
  const [orgId,     setOrgId]     = useState(null)
  const [role,      setRole]      = useState(null)
  const [roleReady, setRoleReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (!cancelled) { setUser(null); setOrgId(null); setRole(null); setRoleReady(true) }
        return
      }
      if (!cancelled) setUser(firebaseUser)
      try {
        const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (cancelled) return
        const oid = userSnap.data()?.organizationId || firebaseUser.uid
        setOrgId(oid)
        const cSnap = await getDoc(doc(db, 'organization_data', oid, 'contractors', firebaseUser.uid))
        if (cancelled) return
        // org owners (uid == orgId) have no contractor doc — treat as admin
        setRole(cSnap.exists() ? (cSnap.data()?.role || 'admin') : 'admin')
      } catch {
        // on error keep role null; components treat null as admin to avoid lockouts
      } finally {
        if (!cancelled) setRoleReady(true)
      }
    })
    return () => { cancelled = true; unsub() }
  }, [])

  return {
    user,
    orgId,
    role,
    // null means still loading — default to true so nothing is accidentally locked out
    isAdmin: role === null || role === 'admin',
    loading: user === undefined || !roleReady,
  }
}

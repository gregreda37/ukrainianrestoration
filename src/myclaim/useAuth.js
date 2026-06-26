import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'

export function useAuth() {
  const [user,           setUser]           = useState(undefined) // undefined = still initializing
  const [orgId,          setOrgId]          = useState(null)
  const [role,           setRole]           = useState(null)
  const [assignedClients,setAssignedClients]= useState([])
  const [pending,        setPending]        = useState(false)
  const [roleReady,      setRoleReady]      = useState(false)

  useEffect(() => {
    let cancelled = false
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (!cancelled) { setUser(null); setOrgId(null); setRole(null); setAssignedClients([]); setPending(false); setRoleReady(true) }
        return
      }
      if (!cancelled) setUser(firebaseUser)
      try {
        const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (cancelled) return
        const data = userSnap.data()
        const oid = data?.organizationId ?? null

        // No org assigned yet, or explicitly pending — wait for invitation
        if (!oid || data?.pending === true) {
          if (!cancelled) { setOrgId(null); setRole(null); setPending(true) }
          return
        }

        setOrgId(oid)
        const cSnap = await getDoc(doc(db, 'organization_data', oid, 'contractors', firebaseUser.uid))
        if (cancelled) return

        if (!cSnap.exists()) {
          if (oid === firebaseUser.uid) {
            // Org owner — no contractor doc is normal, treat as admin
            setRole('admin')
            setPending(false)
          } else {
            // Was removed from the org — revoke access
            setOrgId(null)
            setRole(null)
            setPending(true)
          }
        } else {
          setRole(cSnap.data()?.role || 'admin')
          setAssignedClients(cSnap.data()?.assignedClients || [])
          setPending(false)
        }
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
    assignedClients,
    pending,
    // null means still loading — default to true so nothing is accidentally locked out
    isAdmin: role === null || role === 'admin',
    loading: user === undefined || !roleReady,
  }
}

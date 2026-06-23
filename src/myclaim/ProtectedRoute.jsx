import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

function Splash() {
  return <div className="mc-splash"><div className="mc-spinner" /></div>
}

// Staff only — phone users are redirected to the client portal
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/myclaim/login" replace />
  if (user.phoneNumber) return <Navigate to="/myclaim/portal" replace />
  return children
}

// Phone users only — staff are redirected to the contractor dashboard
export function ProtectedClientRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/myclaim/login" replace />
  if (!user.phoneNumber) return <Navigate to="/myclaim" replace />
  return children
}

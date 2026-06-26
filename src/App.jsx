import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import About from './pages/About'
import Projects from './pages/Projects'
import WaterDamage from './pages/WaterDamage'
import Handyman from './pages/Handyman'
import JunkRemoval from './pages/JunkRemoval'
import Contact from './pages/Contact'
import TermsAndConditions from './pages/TermsAndConditions'
import PrivacyPolicy from './pages/PrivacyPolicy'

function NotFound() {
  return (
    <>
      <div className="page-banner">
        <div className="container">
          <h1>Page Not Found</h1>
          <p>The page you're looking for doesn't exist.</p>
        </div>
      </div>
      <section className="section" style={{ textAlign: 'center' }}>
        <div className="container">
          <a href="/" className="btn btn-primary">Back to Home</a>
        </div>
      </section>
    </>
  )
}

import './myclaim/myclaim.css'
import { useAuth } from './myclaim/useAuth'

// Redirects roles that lack access to certain pages back to the dashboard.
// Default blocked: project_manager. Pass blockedRoles to override.
function AdminRoute({ children, blockedRoles = ['project_manager'] }) {
  const { role, loading } = useAuth()
  if (loading) return null
  if (blockedRoles.includes(role)) return <Navigate to="/myclaim" replace />
  return children
}

const Login          = lazy(() => import('./myclaim/Login'))
const ClientPortal   = lazy(() => import('./myclaim/ClientPortal'))
const ClaimLayout    = lazy(() => import('./myclaim/ClaimLayout'))
const ProtectedRoute      = lazy(() => import('./myclaim/ProtectedRoute'))
const ProtectedClientRoute = lazy(() =>
  import('./myclaim/ProtectedRoute').then(m => ({ default: m.ProtectedClientRoute }))
)
const Dashboard    = lazy(() => import('./myclaim/Dashboard'))
const Clients      = lazy(() => import('./myclaim/Clients'))
const ClientDetail = lazy(() => import('./myclaim/ClientDetail'))
const Chatbot      = lazy(() => import('./myclaim/Chatbot'))
const AIAnalysis   = lazy(() => import('./myclaim/AIAnalysis'))
const Settings     = lazy(() => import('./myclaim/Settings'))
const TeamSettings = lazy(() => import('./myclaim/TeamSettings'))
const Invoices      = lazy(() => import('./myclaim/Invoices'))
const InvoiceEditor = lazy(() => import('./myclaim/InvoiceEditor'))
const OrgInvoices   = lazy(() => import('./myclaim/OrgInvoices'))
const Settlement    = lazy(() => import('./myclaim/Settlement'))
const OptInPolicy      = lazy(() => import('./myclaim/OptInPolicy'))
const PendingApproval  = lazy(() => import('./myclaim/PendingApproval'))

function PortalFallback() {
  return (
    <div className="mc-portal-skel">
      <div className="mc-ps-header">
        <div className="mc-ps-logo-skel" />
        <div className="mc-ps-title-skel" />
      </div>
      <div className="mc-ps-banner" />
      <div className="mc-ps-body">
        <div className="mc-ps-card" style={{ gridColumn: '1', minHeight: 320 }} />
        <div className="mc-ps-col">
          <div className="mc-ps-card" style={{ minHeight: 140 }} />
          <div className="mc-ps-card" style={{ minHeight: 160 }} />
        </div>
      </div>
    </div>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

function PageTransition({ children }) {
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(false)
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [pathname])

  return (
    <div className={`page-transition${visible ? ' page-transition--in' : ''}`}>
      {children}
    </div>
  )
}

function PublicSite() {
  return (
    <>
      <Navbar />
      <main>
        <PageTransition>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/water-damage" element={<WaterDamage />} />
            <Route path="/handyman" element={<Handyman />} />
            <Route path="/junk-removal" element={<JunkRemoval />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/terms" element={<TermsAndConditions />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageTransition>
      </main>
      <Footer />
    </>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const inPortal = pathname.startsWith('/myclaim')

  return (
    <>
      {!inPortal && <ScrollToTop />}
      <Routes>
        {/* ── Login ── */}
        <Route path="/myclaim/login" element={
          <Suspense fallback={<PortalFallback />}><Login /></Suspense>
        } />

        {/* ── SMS opt-in policy (public) ── */}
        <Route path="/myclaim/opt-in-policy" element={
          <Suspense fallback={<PortalFallback />}><OptInPolicy /></Suspense>
        } />

        {/* ── Pending approval (no org yet, or removed from org) ── */}
        <Route path="/myclaim/pending" element={
          <Suspense fallback={<PortalFallback />}><PendingApproval /></Suspense>
        } />

        {/* ── Client portal (phone users) ── */}
        <Route path="/myclaim/portal" element={
          <Suspense fallback={<PortalFallback />}>
            <ProtectedClientRoute>
              <ClientPortal />
            </ProtectedClientRoute>
          </Suspense>
        } />

        {/* ── Contractor portal (email/Google users only) ── */}
        <Route
          path="/myclaim/*"
          element={
            <Suspense fallback={<PortalFallback />}>
              <ProtectedRoute>
                <ClaimLayout />
              </ProtectedRoute>
            </Suspense>
          }
        >
          <Route index element={<Suspense fallback={<PortalFallback />}><Dashboard /></Suspense>} />
          <Route path="clients" element={<Suspense fallback={<PortalFallback />}><Clients /></Suspense>} />
          <Route path="clients/:id" element={<Suspense fallback={<PortalFallback />}><ClientDetail /></Suspense>} />
          <Route path="clients/:id/invoices" element={<Suspense fallback={<PortalFallback />}><Invoices /></Suspense>} />
          <Route path="clients/:id/invoices/:invoiceId" element={<Suspense fallback={<PortalFallback />}><InvoiceEditor /></Suspense>} />
          <Route path="clients/:id/settlement" element={<Suspense fallback={<PortalFallback />}><Settlement /></Suspense>} />
          <Route path="invoices" element={<Suspense fallback={<PortalFallback />}><OrgInvoices /></Suspense>} />
          <Route path="chatbot" element={<AdminRoute><Suspense fallback={<PortalFallback />}><Chatbot /></Suspense></AdminRoute>} />
          <Route path="ai" element={<AdminRoute><Suspense fallback={<PortalFallback />}><AIAnalysis /></Suspense></AdminRoute>} />
          <Route path="settings" element={<Suspense fallback={<PortalFallback />}><Settings /></Suspense>} />
          <Route path="team" element={<Suspense fallback={<PortalFallback />}><TeamSettings /></Suspense>} />
        </Route>

        {/* ── Public site ── */}
        <Route path="/*" element={<PublicSite />} />
      </Routes>
    </>
  )
}

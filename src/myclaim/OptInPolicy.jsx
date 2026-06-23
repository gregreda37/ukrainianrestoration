import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from './useAuth'

const COMPANY_NAME    = 'Ukrainian Restoration'
const COMPANY_PHONE   = '(732) 555-0100'
const COMPANY_EMAIL   = 'info@ukrainianrestoration.com'
const COMPANY_ADDRESS = 'New Jersey, USA'

function formatTs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  })
}

function formatPhone(raw = '') {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

export default function OptInPolicy() {
  const [params]    = useSearchParams()
  const { user }    = useAuth()
  const phoneParam  = params.get('phone') || ''

  const [record,   setRecord]  = useState(null)
  const [loading,  setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!phoneParam || !user) return
    setLoading(true)
    getDoc(doc(db, 'opt_in_records', phoneParam))
      .then(snap => {
        if (snap.exists()) setRecord({ id: snap.id, ...snap.data() })
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [phoneParam, user])

  return (
    <div className="mc-optin-page">
      <div className="mc-optin-inner">

        {/* Header */}
        <div className="mc-optin-header">
          <Link to="/myclaim/login" className="mc-optin-back">← Back to Login</Link>
          <h1 className="mc-optin-title">SMS Opt-In Policy</h1>
          <p className="mc-optin-sub">{COMPANY_NAME} · Text Message Consent</p>
        </div>

        {/* Proof record — only shown when contractor provides a phone param */}
        {phoneParam && user && (
          <div className="mc-optin-proof">
            <div className="mc-optin-proof-header">
              <span className="mc-optin-proof-badge">Consent Record</span>
              <span className="mc-optin-proof-phone">{formatPhone(phoneParam)}</span>
            </div>

            {loading && <p className="mc-optin-proof-empty">Loading record…</p>}

            {notFound && !loading && (
              <p className="mc-optin-proof-empty">
                No opt-in record found for this number. The client may not have signed in yet.
              </p>
            )}

            {record && !loading && (
              <table className="mc-optin-proof-table">
                <tbody>
                  <tr>
                    <td>Phone</td>
                    <td><strong>{formatPhone(record.phone)}</strong></td>
                  </tr>
                  <tr>
                    <td>Consented at</td>
                    <td><strong>{formatTs(record.consentedAt)}</strong></td>
                  </tr>
                  <tr>
                    <td>Method</td>
                    <td>{record.method || 'portal-sms-login'}</td>
                  </tr>
                  <tr>
                    <td>Consent language</td>
                    <td style={{ fontStyle:'italic', color:'#4a5568' }}>{record.consentLanguage}</td>
                  </tr>
                  <tr>
                    <td>Timezone</td>
                    <td>{record.timezone || '—'}</td>
                  </tr>
                  <tr>
                    <td>User agent</td>
                    <td style={{ wordBreak:'break-all', fontSize:12, color:'#718096' }}>{record.userAgent || '—'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Policy text */}
        <div className="mc-optin-section">
          <h2>Program Description</h2>
          <p>
            {COMPANY_NAME} sends text messages to clients who have provided their mobile phone
            number and opted in through our restoration client portal. Messages may include
            claim status updates, appointment reminders, document requests, and project
            milestone notifications.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How You Opted In</h2>
          <p>
            You opted in by entering your mobile phone number on the {COMPANY_NAME} client
            portal login page and checking the consent box before receiving your verification
            code. By completing this action, you consented to receive text messages from us
            at the number you provided.
          </p>
          <div className="mc-optin-consent-box">
            <p>
              <strong>Exact consent language shown at time of opt-in:</strong>
            </p>
            <p className="mc-optin-consent-text">
              "I agree to receive text messages from Ukrainian Restoration. Msg &amp; data
              rates may apply. Reply STOP to opt out."
            </p>
          </div>
        </div>

        <div className="mc-optin-section">
          <h2>Message Frequency</h2>
          <p>
            Message frequency varies based on your active claim. You may receive up to 5
            messages per week during active restoration work.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>Message &amp; Data Rates</h2>
          <p>
            Message and data rates may apply. Check with your carrier for details about your
            plan's messaging charges.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How to Opt Out</h2>
          <p>
            Reply <strong>STOP</strong> to any text message to unsubscribe. You will receive
            one final confirmation message and will not receive further messages unless you
            opt in again. You may also contact us directly to be removed.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How to Get Help</h2>
          <p>
            Reply <strong>HELP</strong> to any message for assistance, or contact us at:
          </p>
          <ul className="mc-optin-contact">
            <li>Phone: {COMPANY_PHONE}</li>
            <li>Email: {COMPANY_EMAIL}</li>
            <li>Address: {COMPANY_ADDRESS}</li>
          </ul>
        </div>

        <div className="mc-optin-section">
          <h2>Privacy</h2>
          <p>
            We do not share, sell, or rent your mobile phone number to third parties for
            their marketing purposes. Your number is used solely to deliver claim-related
            communications from {COMPANY_NAME}.
          </p>
        </div>

        <p className="mc-optin-footer">
          This policy is provided in compliance with TCPA regulations and carrier requirements.
          Last updated: June 2026.
        </p>

      </div>
    </div>
  )
}

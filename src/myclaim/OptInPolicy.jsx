import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from './useAuth'

const COMPANY_NAME    = 'Ukrainian Restoration LLC'
const COMPANY_PHONE   = '(973) 219-4973'
const COMPANY_EMAIL   = 'greg@ukrainianrestoration.com'
const COMPANY_ADDRESS = '90 Mt Kemble Ave, Morristown, NJ 07960'

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
            <strong>{COMPANY_NAME}</strong> operates an SMS notification program for clients
            enrolled in our restoration client portal. Text messages are sent solely to
            provide transactional notifications related to your active restoration claim,
            including:
          </p>
          <ul className="mc-optin-contact" style={{ marginTop: 10 }}>
            <li>Claim status updates and project milestone notifications</li>
            <li>Appointment reminders and scheduling confirmations</li>
            <li>Document upload confirmations and file request alerts</li>
            <li>Direct communications from your assigned project manager</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            This program is strictly transactional. No marketing or promotional messages
            are sent through this service.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How You Opted In</h2>
          <p>
            You opted in by entering your mobile phone number on the {COMPANY_NAME} client
            portal login page and checking the consent checkbox before receiving your
            one-time verification code. Consent is voluntary — you are not required to
            opt in as a condition of receiving restoration services.
          </p>
          <div className="mc-optin-consent-box">
            <p>
              <strong>Consent language presented at time of opt-in:</strong>
            </p>
            <p className="mc-optin-consent-text">
              "By checking this box, I agree to receive text messages from Ukrainian
              Restoration LLC at the mobile number I provided. Messages include claim
              status updates, appointment reminders, document requests, and project
              notifications. Msg &amp; data rates may apply. Message frequency varies.
              Reply STOP to opt out or HELP for help."
            </p>
          </div>
        </div>

        <div className="mc-optin-section">
          <h2>Message Frequency</h2>
          <p>
            Message frequency varies based on the status of your active restoration claim.
            Messages are sent only when there is a relevant update, action required, or
            notification related to your project.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>Message &amp; Data Rates</h2>
          <p>
            Msg &amp; data rates may apply. Contact your wireless carrier for details
            regarding your plan's messaging charges. {COMPANY_NAME} does not charge
            separately for SMS notifications.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How to Opt Out</h2>
          <p>
            You may opt out at any time by replying <strong>STOP</strong> to any text
            message from us. After opting out, you will receive one final confirmation
            message and no further messages will be sent to your number. To re-enroll,
            contact us directly or re-enter your number in the client portal.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>How to Get Help</h2>
          <p>
            Reply <strong>HELP</strong> to any message for assistance. You may also
            reach us directly at:
          </p>
          <ul className="mc-optin-contact">
            <li>Phone: <a href="tel:+19732194973" style={{ color: 'inherit' }}>{COMPANY_PHONE}</a></li>
            <li>Email: <a href={`mailto:${COMPANY_EMAIL}`} style={{ color: 'inherit' }}>{COMPANY_EMAIL}</a></li>
            <li>Address: {COMPANY_ADDRESS}</li>
          </ul>
        </div>

        <div className="mc-optin-section">
          <h2>Privacy &amp; Data Use</h2>
          <p>
            Your mobile phone number is used exclusively to send the transactional
            notifications described in this policy. {COMPANY_NAME} does not sell, share,
            or rent your mobile number to third parties for marketing purposes. For full
            details, see our{' '}
            <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>
              Privacy Policy
            </a>.
          </p>
        </div>

        <div className="mc-optin-section">
          <h2>Carrier Disclaimer</h2>
          <p>
            Carriers are not liable for delayed or undelivered messages. Message delivery
            is subject to your carrier's network availability and coverage.
          </p>
        </div>

        <p className="mc-optin-footer">
          This policy is provided in compliance with TCPA regulations and carrier
          requirements (including Twilio Messaging Policy). Last updated: July 2026.
        </p>

      </div>
    </div>
  )
}

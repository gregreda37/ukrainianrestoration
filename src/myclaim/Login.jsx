import { useState, useRef, useEffect, useCallback } from 'react'
import {
  PhoneAuthProvider,
  signInWithCredential,
  signInWithPopup,
  GoogleAuthProvider,
  getAuth,
} from 'firebase/auth'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { auth, db } from '../firebase'
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore'
import { useAuth } from './useAuth'


const CONSENT_LANGUAGE =
  'By clicking "Send Code", I agree to receive text messages from Ukrainian Restoration ' +
  'at the number provided. Message frequency varies. Msg & data rates may apply. ' +
  'Reply STOP to opt out, HELP for help.'

const SECURE_MESSAGES = [
  'Verifying your identity…',
  'Securely fetching your claim information…',
  'Encrypting your connection…',
  'Loading your restoration portal…',
]

const FEATURES = [
  'Real-time claim status updates',
  'Before & after photo documentation',
  'Estimates, invoices & insurance docs',
  'Project timeline & next steps',
]

export default function Login() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sessionInfo, setSessionInfo] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [entered, setEntered] = useState(false)
  const [msgIndex, setMsgIndex] = useState(0)
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(t)
  }, [])

  useEffect(() => { return () => {} }, [])

  if (loading) return <div className="mc-splash"><div className="mc-spinner" /></div>
  if (user && step !== 'loading') return <Navigate to={user.phoneNumber ? '/myclaim/portal' : '/myclaim'} replace />

  async function handleSendCode(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const e164 = toE164(phone)
      if (!e164) { setError('Enter a valid 10-digit US number.'); setSubmitting(false); return }

      // Block unregistered numbers — clients must be added by their contractor first
      const phoneSnap = await getDoc(doc(db, 'client_phones', e164))
      if (!phoneSnap.exists()) {
        setError("This number isn’t registered with any active claim. Contact your contractor to be added.")
        setSubmitting(false)
        return
      }

      // Record opt-in consent before the SMS is sent — TCPA compliance
      setDoc(doc(db, 'opt_in_records', e164), {
        phone:           e164,
        consentedAt:     serverTimestamp(),
        consentLanguage: CONSENT_LANGUAGE,
        method:          'portal-sms-login',
        userAgent:       navigator.userAgent,
        timezone:        Intl.DateTimeFormat().resolvedOptions().timeZone,
        consentCount:    1,
      }, { merge: true }).catch(() => {})

      // Use the preloaded reCAPTCHA Enterprise instance (index.html script tag).
      // We call execute() directly to avoid the SDK loading a second instance,
      // which crashes with "null.style" on localhost.
      const enterpriseToken = await new Promise((resolve, reject) => {
        window.grecaptcha.enterprise.ready(() => {
          window.grecaptcha.enterprise
            .execute('6Ld6bTItAAAAAEx2mwglMq9OehRUyD7cVGq3otuS', { action: 'sendVerificationCode' })
            .then(resolve)
            .catch(reject)
        })
      })

      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${import.meta.env.VITE_FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: e164,
            captchaResponse: enterpriseToken,
            clientType: 'CLIENT_TYPE_WEB',
            recaptchaVersion: 'RECAPTCHA_ENTERPRISE',
          }),
        }
      )
      const data = await resp.json()
      if (!resp.ok) {
        const msg = data.error?.message || 'SEND_FAILED'
        throw Object.assign(new Error(msg), { code: 'auth/' + msg.toLowerCase().replace(/_/g, '-') })
      }
      setSessionInfo(data.sessionInfo)
      setStep('code')

    } catch (err) {
      setError(friendlyPhoneError(err.code, err.message))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const credential = PhoneAuthProvider.credential(sessionInfo, code)
      await signInWithCredential(getAuth(), credential)
      setMsgIndex(0)
      setStep('loading')
      let i = 0
      const interval = setInterval(() => {
        i += 1
        if (i < SECURE_MESSAGES.length) setMsgIndex(i)
        else clearInterval(interval)
      }, 750)
      setTimeout(() => {
        clearInterval(interval)
        navigate('/myclaim/portal')
      }, 3000)
    } catch (err) {
      setError(err.code === 'auth/invalid-verification-code' ? 'Incorrect code. Try again.' : err.message)
      setSubmitting(false)
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    setSubmitting(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      const { uid, displayName, email, photoURL } = result.user

      const userRef = doc(db, 'users', uid)
      const snap = await getDoc(userRef)
      const existingOrgId = snap.data()?.organizationId

      // Check for a pending invite — takes priority over self-org bootstrap
      const encodedEmail = email.toLowerCase().replace(/\./g, '__dot__').replace(/@/g, '__at__')
      const inviteSnap = await getDoc(doc(db, 'user_invites', encodedEmail))

      if (inviteSnap.exists() && (!existingOrgId || existingOrgId === uid)) {
        const { orgId: inviteOrgId, role: inviteRole } = inviteSnap.data()
        await setDoc(userRef, {
          displayName: displayName || '',
          email: email || '',
          photoURL: photoURL || '',
          organizationId: inviteOrgId,
          role: 'contractor',
          createdAt: serverTimestamp(),
        }, { merge: true })
        await setDoc(doc(db, 'organization_data', inviteOrgId, 'contractors', uid), {
          email: email || '',
          displayName: displayName || '',
          role: inviteRole || 'project_manager',
          joinedAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        }, { merge: true })
        // Clean up invite records
        await deleteDoc(doc(db, 'user_invites', encodedEmail)).catch(() => {})
        const orgInvites = await getDocs(
          query(collection(db, 'organization_data', inviteOrgId, 'invites'), where('email', '==', email.toLowerCase()))
        ).catch(() => ({ docs: [] }))
        for (const d of orgInvites.docs) {
          await deleteDoc(d.ref).catch(() => {})
        }
      } else if (!snap.exists() || !existingOrgId) {
        // Normal first login — bootstrap their own org
        const orgId = existingOrgId || uid
        await setDoc(userRef, {
          displayName: displayName || '',
          email: email || '',
          photoURL: photoURL || '',
          organizationId: orgId,
          role: 'contractor',
          createdAt: serverTimestamp(),
        }, { merge: true })
        await setDoc(doc(db, 'organization_data', orgId), {
          createdAt: serverTimestamp(),
        }, { merge: true })
      }

      navigate('/myclaim')
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(friendlyGoogleError(err.code))
      }
      setSubmitting(false)
    }
  }

  if (step === 'loading') {
    return (
      <div className="mc-secure-loading">
        <div className="mc-sl-inner">
          <div className="mc-sl-ring">
            <div className="mc-sl-ring-track" />
            <div className="mc-sl-shield">
              <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
                <path d="M14 1L2 6v9c0 7.18 5.16 13.89 12 15.5C20.84 28.89 26 22.18 26 15V6L14 1z" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M9 16l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          <p key={msgIndex} className="mc-sl-message">{SECURE_MESSAGES[msgIndex]}</p>
          <div className="mc-sl-badges">
            <span className="mc-sl-badge">🔒 256-bit TLS</span>
            <span className="mc-sl-badge">✦ No data stored locally</span>
            <span className="mc-sl-badge">✓ Identity verified</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`mc-login${entered ? ' mc-login--entered' : ''}`}>

      {/* ── Left panel ── */}
      <div className="mc-login__panel">
        <div className="mc-login__panel-inner">
          <span className="mc-login__panel-brand">Ukrainian Restoration</span>

          <h2 className="mc-login__panel-title">
            Track your<br />
            <em>restoration</em><br />
            every step.
          </h2>

          <p className="mc-login__panel-sub">
            Everything related to your claim — in one place, always up to date.
          </p>

          <ul className="mc-login__features">
            {FEATURES.map(f => (
              <li key={f} className="mc-login__feature">
                <span className="mc-login__feature-check">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="mc-login__card-wrap">

        <div className="mc-login__card">

          {/* Phone entry */}
          {step === 'phone' && (
            <>
              <h1 className="mc-login__title">Welcome back.</h1>
              <p className="mc-login__sub">Sign in with the number on your claim.</p>

              <form className="mc-login__form" onSubmit={handleSendCode} noValidate>
                <div className="mc-field-group">
                  <label className="mc-field-label">MOBILE NUMBER</label>
                  <div className="mc-phone-field">
                    <span className="mc-phone-field__prefix">+1</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="(555) 000-0000"
                      autoFocus
                      required
                    />
                  </div>
                </div>
                <label className="mc-login__consent">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    className="mc-login__consent-check"
                  />
                  <span>
                    I agree to receive text messages from Ukrainian Restoration.
                    Msg &amp; data rates may apply. Reply STOP to opt out.{' '}
                    <Link to="/myclaim/opt-in-policy" target="_blank" className="mc-login__consent-link">
                      View policy
                    </Link>
                  </span>
                </label>
                {error && <p className="mc-login__error">{error}</p>}
                <div id="recaptcha-container" style={{ position: 'absolute', visibility: 'hidden', height: 0, overflow: 'hidden' }} />
                <button className="mc-btn-pill" type="submit" disabled={submitting || !agreed}>
                  {submitting ? <><span className="mc-btn-spinner mc-btn-spinner--dark" /> Sending…</> : 'Send Code'}
                </button>
              </form>
            </>
          )}

          {/* Code verification */}
          {step === 'code' && (
            <>
              <button className="mc-login__back" type="button" onClick={() => { setStep('phone'); setCode(''); setError('') }}>
                ← Back
              </button>
              <h1 className="mc-login__title">Enter code.</h1>
              <p className="mc-login__sub">We texted a 6-digit code to {phone}.</p>

              <form className="mc-login__form" onSubmit={handleVerifyCode} noValidate>
                <div className="mc-field-group">
                  <label className="mc-field-label">VERIFICATION CODE</label>
                  <input
                    className="mc-input-plain mc-code-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="— — — — — —"
                    autoFocus
                    required
                  />
                </div>
                {error && <p className="mc-login__error">{error}</p>}
                <button className="mc-btn-pill" type="submit" disabled={submitting || code.length < 6}>
                  {submitting ? <><span className="mc-btn-spinner mc-btn-spinner--dark" /> Verifying…</> : 'Verify & Sign In'}
                </button>
              </form>
            </>
          )}

          {/* Staff Google sign-in */}
          {step === 'admin' && (
            <>
              <button className="mc-login__back" type="button" onClick={() => { setStep('phone'); setError('') }}>
                ← Back
              </button>
              <h1 className="mc-login__title">Staff sign-in.</h1>
              <p className="mc-login__sub">Contractor &amp; admin access only.</p>

              <div className="mc-login__form">
                {error && <p className="mc-login__error">{error}</p>}
                <button
                  className="mc-btn-google"
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={submitting}
                >
                  {submitting ? (
                    <><span className="mc-btn-spinner mc-btn-spinner--dark" /> Signing in…</>
                  ) : (
                    <><GoogleIcon /> Continue with Google</>
                  )}
                </button>
              </div>
            </>
          )}

          {step !== 'admin' && (
            <button className="mc-login__admin-link" type="button" onClick={() => { setStep('admin'); setError('') }}>
              Admin login
            </button>
          )}

        </div>
      </div>

    </div>
  )
}

function toE164(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return null
}

function friendlyPhoneError(code, message) {
  switch (code) {
    case 'auth/invalid-phone-number':    return 'Invalid phone number. Enter a 10-digit US number.'
    case 'auth/too-many-requests':
    case 'auth/too_many_attempts_try_later': return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/captcha-check-failed':
    case 'auth/recaptcha-not-enabled':   return 'Verification failed. Refresh and try again.'
    case 'auth/operation-not-allowed':   return 'Phone sign-in is not enabled. Contact support.'
    case 'auth/quota-exceeded':          return 'SMS quota exceeded. Try again later.'
    case 'auth/network-request-failed':  return 'Network error. Check your connection and try again.'
    default: return `Could not send code (${code ?? message ?? 'unknown'}). Try again.`
  }
}

function friendlyGoogleError(code) {
  switch (code) {
    case 'auth/account-exists-with-different-credential': return 'An account already exists with a different sign-in method.'
    case 'auth/unauthorized-domain': return 'This domain is not authorized for Google sign-in.'
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.'
    default: return 'Google sign-in failed. Please try again.'
  }
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

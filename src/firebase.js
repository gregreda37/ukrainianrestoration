import { initializeApp } from 'firebase/app'
import { getAnalytics } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Firebase Auth SDK v9.19+ always sends Enterprise-format phone auth requests even when
// Enterprise initialization fails ("NO_RECAPTCHA" fallback). Without a provisioned
// Enterprise key the server rejects it. Intercept and convert to the legacy v2 format
// so the server validates the actual reCAPTCHA v2 token in recaptchaToken.
if (typeof window !== 'undefined') {
  const _origFetch = window.fetch
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : ''
    if (url.includes('sendVerificationCode') && args[1]?.body) {
      try {
        const body = JSON.parse(args[1].body)
        if (body.captchaResponse === 'NO_RECAPTCHA' && body.recaptchaToken) {
          const legacyBody = { phoneNumber: body.phoneNumber, recaptchaToken: body.recaptchaToken }
          args = [args[0], { ...args[1], body: JSON.stringify(legacyBody) }]
        }
      } catch (_) {}
    }
    return _origFetch(...args)
  }
}

export const app = initializeApp(firebaseConfig)
export const analytics = getAnalytics(app)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)


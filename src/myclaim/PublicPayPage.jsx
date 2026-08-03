import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import './PublicPayPage.css'

const BACKEND = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
const PK      = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''

let _stripePromise = null
function getStripe() {
  if (!_stripePromise && PK) _stripePromise = loadStripe(PK)
  return _stripePromise
}

function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function CheckoutForm({ inv, onSuccess }) {
  const stripe   = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError('')

    const { error: submitErr } = await elements.submit()
    if (submitErr) { setError(submitErr.message); setPaying(false); return }

    const { error: confirmErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })

    if (confirmErr) {
      setError(confirmErr.message)
      setPaying(false)
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess()
    } else {
      setPaying(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ppp-checkout-form">
      <div className="ppp-fee-breakdown">
        <div className="ppp-fee-row">
          <span>Invoice total</span>
          <span>{fmtMoney(inv.total)}</span>
        </div>
        <div className="ppp-fee-row ppp-fee-row--fee">
          <span>Processing fee (2.9% + $0.30)</span>
          <span>{fmtMoney(inv.fee)}</span>
        </div>
        <div className="ppp-fee-divider" />
        <div className="ppp-fee-row ppp-fee-row--total">
          <span>Amount charged</span>
          <span>{fmtMoney(inv.totalCharged)}</span>
        </div>
      </div>

      <div className="ppp-elements-wrap">
        <PaymentElement />
      </div>

      {error && <div className="ppp-form-error">{error}</div>}

      <button
        type="submit"
        className="ppp-pay-btn"
        disabled={!stripe || !elements || paying}
      >
        {paying ? 'Processing…' : `Pay ${fmtMoney(inv.totalCharged)}`}
      </button>
      <p className="ppp-secure-note">🔒 Payments processed securely by Stripe</p>
    </form>
  )
}

export default function PublicPayPage() {
  const { token } = useParams()

  const [inv,           setInv]           = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [err,           setErr]           = useState('')
  const [alreadyPaid,   setAlreadyPaid]   = useState(false)
  const [paidMeta,      setPaidMeta]      = useState(null)
  const [step,          setStep]          = useState('invoice') // 'invoice' | 'pay' | 'success'
  const [clientSecret,  setClientSecret]  = useState(null)
  const [secretLoading, setSecretLoading] = useState(false)
  const [secretErr,     setSecretErr]     = useState('')

  useEffect(() => {
    if (!token) { setErr('Invalid payment link.'); setLoading(false); return }
    fetch(`${BACKEND}/stripe/payment-link/${token}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok || data.error) { setErr(data.error || 'Could not load invoice.'); return }
        if (data.alreadyPaid) { setAlreadyPaid(true); setPaidMeta(data); return }
        setInv(data)
      })
      .catch(() => setErr('Could not load this payment link. Please try again.'))
      .finally(() => setLoading(false))
  }, [token])

  async function startPayment() {
    setSecretLoading(true)
    setSecretErr('')
    try {
      const r = await fetch(`${BACKEND}/stripe/payment-intent-public`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      })
      const data = await r.json()
      if (!r.ok || data.error) { setSecretErr(data.error || 'Could not start payment.'); return }
      setClientSecret(data.clientSecret)
      setStep('pay')
    } catch {
      setSecretErr('Network error. Please try again.')
    } finally {
      setSecretLoading(false)
    }
  }

  const appearance = {
    theme: 'stripe',
    variables: { colorPrimary: '#2563eb', borderRadius: '8px', fontFamily: 'system-ui, sans-serif' },
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="ppp-shell">
        <div className="ppp-loading">
          <div className="ppp-spinner" />
          <p>Loading invoice…</p>
        </div>
      </div>
    )
  }

  // ── Error ──
  if (err) {
    return (
      <div className="ppp-shell">
        <div className="ppp-status-card">
          <div className="ppp-status-icon ppp-status-icon--warn">!</div>
          <h2 className="ppp-status-title">Link Unavailable</h2>
          <p className="ppp-status-body">{err}</p>
          <p className="ppp-status-sub">This link may have expired or is no longer valid. Contact your contractor for a new link.</p>
        </div>
      </div>
    )
  }

  // ── Already paid ──
  if (alreadyPaid) {
    return (
      <div className="ppp-shell">
        <div className="ppp-status-card">
          <div className="ppp-status-icon ppp-status-icon--ok">✓</div>
          <h2 className="ppp-status-title">Invoice Paid</h2>
          <p className="ppp-status-body">
            Invoice {paidMeta?.invoiceNumber} from {paidMeta?.companyName} has already been paid.
          </p>
          <p className="ppp-status-sub">No further action needed. Thank you!</p>
        </div>
      </div>
    )
  }

  // ── Payment success ──
  if (step === 'success') {
    return (
      <div className="ppp-shell">
        <div className="ppp-status-card">
          <div className="ppp-status-icon ppp-status-icon--ok">✓</div>
          <h2 className="ppp-status-title">Payment Successful</h2>
          <p className="ppp-status-body">
            Your payment of {fmtMoney(inv?.totalCharged)} has been received.
          </p>
          <p className="ppp-status-sub">
            Thank you! A confirmation will be sent once your payment is processed.
          </p>
        </div>
      </div>
    )
  }

  if (!inv) return null

  return (
    <div className="ppp-shell">
      <div className="ppp-card">
        {/* Company header */}
        <div className="ppp-header">
          <div className="ppp-company-name">{inv.companyName}</div>
          {inv.companyPhone && <div className="ppp-company-phone">{inv.companyPhone}</div>}
        </div>

        <div className="ppp-body">
          {/* Invoice meta */}
          <div className="ppp-meta-section">
            <div className="ppp-meta-row">
              <span className="ppp-meta-label">Invoice</span>
              <span className="ppp-meta-value">{inv.invoiceNumber || '—'}</span>
            </div>
            {inv.clientName && (
              <div className="ppp-meta-row">
                <span className="ppp-meta-label">Billed to</span>
                <span className="ppp-meta-value">{inv.clientName}</span>
              </div>
            )}
            {inv.issueDate && (
              <div className="ppp-meta-row">
                <span className="ppp-meta-label">Issue date</span>
                <span className="ppp-meta-value">{fmtDate(inv.issueDate)}</span>
              </div>
            )}
            {inv.dueDate && (
              <div className="ppp-meta-row">
                <span className="ppp-meta-label">Due date</span>
                <span className="ppp-meta-value">{fmtDate(inv.dueDate)}</span>
              </div>
            )}
          </div>

          {/* Line items */}
          {inv.lineItems?.length > 0 && (
            <div className="ppp-lines">
              <div className="ppp-lines-header">
                <span>Item</span>
                <span>Amount</span>
              </div>
              {inv.lineItems.map((it, i) => (
                <div key={i} className="ppp-line-row">
                  <div className="ppp-line-left">
                    <div className="ppp-line-label">{it.label}</div>
                    {it.description && <div className="ppp-line-desc">{it.description}</div>}
                  </div>
                  <div className="ppp-line-total">{fmtMoney(parseFloat(it.total) || 0)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="ppp-totals">
            {inv.subtotal != null && (
              <div className="ppp-total-row">
                <span>Subtotal</span>
                <span>{fmtMoney(inv.subtotal)}</span>
              </div>
            )}
            {inv.taxAmount > 0 && (
              <div className="ppp-total-row">
                <span>Tax</span>
                <span>{fmtMoney(inv.taxAmount)}</span>
              </div>
            )}
            {(inv.discount || 0) > 0 && (
              <div className="ppp-total-row ppp-total-row--discount">
                <span>Discount</span>
                <span>– {fmtMoney(inv.discount)}</span>
              </div>
            )}
            <div className="ppp-totals-divider" />
            <div className="ppp-total-row ppp-total-row--grand">
              <span>Invoice Total</span>
              <span>{fmtMoney(inv.total)}</span>
            </div>
          </div>

          {/* Notes */}
          {inv.notes && (
            <div className="ppp-notes">
              <div className="ppp-notes-label">Notes</div>
              <p className="ppp-notes-body">{inv.notes}</p>
            </div>
          )}

          {/* Payment section */}
          <div className="ppp-pay-section">
            {step === 'invoice' && (
              <>
                <div className="ppp-fee-hint">
                  A 2.9% + $0.30 processing fee will be added at checkout.
                </div>
                {secretErr && <div className="ppp-form-error">{secretErr}</div>}
                <button
                  className="ppp-pay-btn"
                  onClick={startPayment}
                  disabled={secretLoading}
                >
                  {secretLoading ? 'Preparing…' : 'Pay with Card'}
                </button>
              </>
            )}

            {step === 'pay' && clientSecret && (
              <Elements stripe={getStripe()} options={{ clientSecret, appearance }}>
                <CheckoutForm inv={inv} onSuccess={() => setStep('success')} />
              </Elements>
            )}
          </div>
        </div>

        <div className="ppp-footer">
          Secured by Stripe &nbsp;·&nbsp; {inv.companyName}
        </div>
      </div>
    </div>
  )
}

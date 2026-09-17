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

function CheckoutForm({ invoiceTotal, fee, totalCharged, paymentType, onSuccess }) {
  const stripe   = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error,  setError]  = useState('')

  // Enable the button as soon as the Stripe context resolves — works even if
  // onReady fires before this component finishes mounting.
  const ready = !!(stripe && elements)

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
    } else if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      onSuccess()
    } else {
      setPaying(false)
    }
  }

  const amountLabel = paymentType === 'deposit' ? 'Deposit amount'
    : paymentType === 'balance' ? 'Remaining balance'
    : 'Invoice total'

  return (
    <form onSubmit={handleSubmit} className="ppp-checkout-form">
      <div className="ppp-fee-breakdown">
        <div className="ppp-fee-row">
          <span>{amountLabel}</span>
          <span>{fmtMoney(invoiceTotal)}</span>
        </div>
        <div className="ppp-fee-row ppp-fee-row--fee">
          <span>Processing fee (2.9% + $0.30)</span>
          <span>{fmtMoney(fee)}</span>
        </div>
        <div className="ppp-fee-divider" />
        <div className="ppp-fee-row ppp-fee-row--total">
          <span>Amount charged</span>
          <span>{fmtMoney(totalCharged)}</span>
        </div>
      </div>

      <div className="ppp-elements-wrap">
        <PaymentElement />
      </div>

      {error && <div className="ppp-form-error">{error}</div>}

      <button
        type="submit"
        className="ppp-pay-btn"
        disabled={!ready || paying}
      >
        {paying ? 'Processing…' : `Pay ${fmtMoney(totalCharged)}`}
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
  const [paymentType,   setPaymentType]   = useState('full') // 'deposit' | 'full' | 'balance'
  const [paymentAmounts, setPaymentAmounts] = useState(null) // { invoiceTotal, fee, totalCharged }
  const [showPreview,   setShowPreview]   = useState(false)

  useEffect(() => {
    if (!token) { setErr('Invalid payment link.'); setLoading(false); return }

    // Stripe redirects back here after 3D Secure / redirect-required flows
    // with ?redirect_status=succeeded|failed&payment_intent=...
    const params = new URLSearchParams(window.location.search)
    const redirectStatus = params.get('redirect_status')
    if (redirectStatus === 'succeeded') {
      setStep('success')
      setLoading(false)
      return
    }
    if (redirectStatus === 'failed') {
      setErr('Payment was not completed. Please try again.')
      setLoading(false)
      return
    }

    fetch(`${BACKEND}/stripe/payment-link/${token}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok || data.error) { setErr(data.error || 'Could not load invoice.'); return }
        if (data.alreadyPaid) { setAlreadyPaid(true); setPaidMeta(data); return }
        setInv(data)
        setPaymentType(data.depositPaid ? 'balance' : data.depositAmount > 0 ? 'deposit' : 'full')
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
        body:    JSON.stringify({ token, paymentType }),
      })
      const data = await r.json()
      if (!r.ok || data.error) { setSecretErr(data.error || 'Could not start payment.'); return }
      setPaymentAmounts({ invoiceTotal: data.invoiceTotal, fee: data.fee, totalCharged: data.totalCharged })
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
    const chargedAmt = paymentAmounts?.totalCharged ?? inv?.totalCharged
    const isDeposit  = paymentType === 'deposit'
    const remaining  = inv && paymentAmounts ? inv.total - paymentAmounts.invoiceTotal : null
    return (
      <div className="ppp-shell">
        <div className="ppp-status-card">
          <div className="ppp-status-icon ppp-status-icon--ok">✓</div>
          <h2 className="ppp-status-title">{isDeposit ? 'Deposit Received' : 'Payment Received'}</h2>
          <p className="ppp-status-body">
            Your {isDeposit ? 'deposit' : 'payment'}{chargedAmt ? ` of ${fmtMoney(chargedAmt)}` : ''} has been submitted successfully.
          </p>
          <p className="ppp-status-sub">
            {isDeposit && remaining != null
              ? `Remaining balance of ${fmtMoney(remaining)} will be due upon completion.`
              : 'Thank you! Your contractor will be notified once the payment clears.'}
          </p>
          {inv && (
            <button className="ppp-view-invoice-btn" onClick={() => setShowPreview(true)}>
              View Invoice
            </button>
          )}
        </div>
        {showPreview && inv && <InvoicePreviewModal inv={inv} onClose={() => setShowPreview(false)} />}
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
            <button className="ppp-preview-link" onClick={() => setShowPreview(true)}>
              View Invoice ↗
            </button>
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
                {inv.depositAmount > 0 && (
                  <div className="ppp-pay-options">
                    {inv.depositPaid ? (
                      <div className="ppp-deposit-paid-banner">
                        <span className="ppp-deposit-paid-check">✓</span>
                        <div>
                          <div className="ppp-deposit-paid-title">Deposit paid — {fmtMoney(inv.depositPaidAmount)}</div>
                          <div className="ppp-deposit-paid-sub">Remaining balance: {fmtMoney(inv.total - inv.depositPaidAmount)}</div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`ppp-pay-option${paymentType === 'deposit' ? ' ppp-pay-option--active' : ''}`}
                          onClick={() => setPaymentType('deposit')}
                        >
                          <div>
                            <div className="ppp-pay-option-label">Pay deposit</div>
                            <div className="ppp-pay-option-hint">Due now</div>
                          </div>
                          <span className="ppp-pay-option-amount">{fmtMoney(inv.depositAmount)}</span>
                        </button>
                        <button
                          type="button"
                          className={`ppp-pay-option${paymentType === 'full' ? ' ppp-pay-option--active' : ''}`}
                          onClick={() => setPaymentType('full')}
                        >
                          <div>
                            <div className="ppp-pay-option-label">Pay in full</div>
                            <div className="ppp-pay-option-hint">Invoice total</div>
                          </div>
                          <span className="ppp-pay-option-amount">{fmtMoney(inv.total)}</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="ppp-fee-hint">
                  A 2.9% + $0.30 processing fee will be added at checkout.
                </div>
                {secretErr && <div className="ppp-form-error">{secretErr}</div>}
                <button
                  className="ppp-pay-btn"
                  onClick={startPayment}
                  disabled={secretLoading}
                >
                  {secretLoading ? 'Preparing…'
                    : paymentType === 'deposit' ? 'Pay Deposit'
                    : paymentType === 'balance' ? 'Pay Remaining Balance'
                    : 'Pay in Full'}
                </button>
              </>
            )}

            {step === 'pay' && clientSecret && (
              <Elements stripe={getStripe()} options={{ clientSecret, appearance }}>
                <CheckoutForm
                  invoiceTotal={paymentAmounts?.invoiceTotal ?? inv.total}
                  fee={paymentAmounts?.fee ?? inv.fee}
                  totalCharged={paymentAmounts?.totalCharged ?? inv.totalCharged}
                  paymentType={paymentType}
                  onSuccess={() => setStep('success')}
                />
              </Elements>
            )}
          </div>
        </div>

        <div className="ppp-footer">
          Secured by Stripe &nbsp;·&nbsp; {inv.companyName}
        </div>
      </div>
      {showPreview && <InvoicePreviewModal inv={inv} onClose={() => setShowPreview(false)} />}
    </div>
  )
}

function InvoicePreviewModal({ inv, onClose }) {
  return (
    <div className="ppp-modal-overlay" onClick={onClose}>
      <div className="ppp-modal-doc" onClick={e => e.stopPropagation()}>

        {/* Document header */}
        <div className="ppp-modal-doc-header">
          <div>
            <div className="ppp-modal-doc-company">{inv.companyName}</div>
            {inv.companyPhone && <div className="ppp-modal-doc-phone">{inv.companyPhone}</div>}
          </div>
          <div className="ppp-modal-doc-title-block">
            <div className="ppp-modal-doc-title">INVOICE</div>
            {inv.invoiceNumber && <div className="ppp-modal-doc-num">#{inv.invoiceNumber}</div>}
          </div>
        </div>

        {/* Bill-to + dates */}
        <div className="ppp-modal-doc-meta">
          <div>
            <div className="ppp-modal-doc-meta-label">Billed To</div>
            <div className="ppp-modal-doc-meta-val">{inv.clientName || '—'}</div>
          </div>
          <div className="ppp-modal-doc-dates">
            {inv.issueDate && (
              <div className="ppp-modal-doc-date-row">
                <span>Issue Date</span><span>{fmtDate(inv.issueDate)}</span>
              </div>
            )}
            {inv.dueDate && (
              <div className="ppp-modal-doc-date-row">
                <span>Due Date</span><span>{fmtDate(inv.dueDate)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="ppp-modal-doc-divider" />

        {/* Line items */}
        {inv.lineItems?.length > 0 && (
          <div className="ppp-modal-doc-table-wrap">
            <table className="ppp-modal-doc-table">
              <thead>
                <tr>
                  <th className="ppp-modal-doc-th">Description</th>
                  <th className="ppp-modal-doc-th ppp-modal-doc-th--right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lineItems.map((it, i) => (
                  <tr key={i} className="ppp-modal-doc-tr">
                    <td className="ppp-modal-doc-td">
                      <div className="ppp-modal-doc-item-label">{it.label}</div>
                      {it.description && <div className="ppp-modal-doc-item-desc">{it.description}</div>}
                    </td>
                    <td className="ppp-modal-doc-td ppp-modal-doc-td--right">
                      {fmtMoney(parseFloat(it.total) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        <div className="ppp-modal-doc-totals">
          {inv.subtotal != null && (
            <div className="ppp-modal-doc-total-row">
              <span>Subtotal</span><span>{fmtMoney(inv.subtotal)}</span>
            </div>
          )}
          {(inv.taxAmount || 0) > 0 && (
            <div className="ppp-modal-doc-total-row">
              <span>Tax</span><span>{fmtMoney(inv.taxAmount)}</span>
            </div>
          )}
          {(inv.discount || 0) > 0 && (
            <div className="ppp-modal-doc-total-row ppp-modal-doc-total-row--discount">
              <span>Discount</span><span>– {fmtMoney(inv.discount)}</span>
            </div>
          )}
          {inv.depositPaid && inv.depositPaidAmount > 0 && (
            <div className="ppp-modal-doc-total-row ppp-modal-doc-total-row--deposit">
              <span>Deposit Paid</span><span>– {fmtMoney(inv.depositPaidAmount)}</span>
            </div>
          )}
          <div className="ppp-modal-doc-divider" />
          <div className="ppp-modal-doc-total-row ppp-modal-doc-total-row--grand">
            <span>{inv.depositPaid ? 'Remaining Balance' : 'Total Due'}</span>
            <span>{fmtMoney(inv.depositPaid ? inv.total - inv.depositPaidAmount : inv.total)}</span>
          </div>
        </div>

        {/* Notes */}
        {inv.notes && (
          <div className="ppp-modal-doc-notes">
            <div className="ppp-modal-doc-notes-label">Notes</div>
            <p className="ppp-modal-doc-notes-body">{inv.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="ppp-modal-doc-actions ppp-no-print">
          <button className="ppp-modal-doc-print-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
          <button className="ppp-modal-doc-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

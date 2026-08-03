import React, { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import "./StripePayModal.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";

// Singleton promise — loadStripe is called once for the lifetime of the page
let _stripePromise = null;
function getStripe() {
  if (!_stripePromise && PUBLISHABLE_KEY) {
    _stripePromise = loadStripe(PUBLISHABLE_KEY);
  }
  return _stripePromise;
}

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

// ── Inner form (must be inside <Elements>) ───────────────────────────────────
function CheckoutForm({ invoiceTotal, fee, totalCharged, onSuccess, onCancel }) {
  const stripe   = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  const [ready,      setReady]      = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      onSuccess(paymentIntent);
    } else {
      setError("Payment did not complete. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form className="spm-form" onSubmit={handleSubmit}>
      <div className="spm-breakdown">
        <div className="spm-breakdown-row">
          <span>Invoice amount</span>
          <span>{fmt(invoiceTotal)}</span>
        </div>
        <div className="spm-breakdown-row spm-breakdown-fee">
          <span>Processing fee (2.9% + $0.30)</span>
          <span>{fmt(fee)}</span>
        </div>
        <div className="spm-breakdown-row spm-breakdown-total">
          <span>Total charged today</span>
          <span>{fmt(totalCharged)}</span>
        </div>
      </div>

      <div className="spm-element-wrap">
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: "tabs" }}
        />
      </div>

      {error && <p className="spm-error">{error}</p>}

      <div className="spm-actions">
        <button type="button" className="spm-btn-cancel" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="submit"
          className="spm-btn-pay"
          disabled={!stripe || !ready || submitting}
        >
          {submitting ? (
            <><span className="spm-spinner" /> Processing…</>
          ) : (
            `Pay ${fmt(totalCharged)}`
          )}
        </button>
      </div>
    </form>
  );
}

// ── Outer modal — fetches clientSecret, wraps Elements ───────────────────────
export default function StripePayModal({
  invoice,
  orgId,
  clientDocId,
  user,
  onSuccess,
  onClose,
}) {
  const [clientSecret,  setClientSecret]  = useState(null);
  const [breakdown,     setBreakdown]     = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [initError,     setInitError]     = useState("");
  const [paid,          setPaid]          = useState(false);

  const API = import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

  useEffect(() => {
    if (!user || !invoice?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res   = await fetch(`${API}/stripe/create-payment-intent`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orgId, clientDocId, invoiceId: invoice.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not initialize payment.");
        if (cancelled) return;
        setClientSecret(data.clientSecret);
        setBreakdown({ fee: data.fee, invoiceTotal: data.invoiceTotal, totalCharged: data.totalCharged });
      } catch (err) {
        if (!cancelled) setInitError(err.message || "Could not initialize payment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, invoice?.id]);

  const handleSuccess = useCallback((paymentIntent) => {
    setPaid(true);
    onSuccess(paymentIntent);
  }, [onSuccess]);

  const stripePromise = getStripe();
  const elementsOptions = clientSecret
    ? { clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#2563eb" } } }
    : null;

  return (
    <div className="spm-overlay" onClick={(e) => { if (e.target === e.currentTarget && !paid) onClose(); }}>
      <div className="spm-modal">
        <div className="spm-header">
          <div>
            <h2 className="spm-title">Pay Invoice</h2>
            <p className="spm-subtitle">
              {invoice.invoiceNumber} · Due {invoice.dueDate || "on receipt"}
            </p>
          </div>
          {!paid && (
            <button className="spm-close" onClick={onClose} aria-label="Close">✕</button>
          )}
        </div>

        {loading && (
          <div className="spm-loading">
            <span className="spm-spinner spm-spinner--lg" />
            <p>Preparing secure checkout…</p>
          </div>
        )}

        {!loading && initError && (
          <div className="spm-init-error">
            <p>{initError}</p>
            <button className="spm-btn-cancel" onClick={onClose}>Close</button>
          </div>
        )}

        {!loading && !initError && paid && (
          <div className="spm-success">
            <div className="spm-success-icon">✓</div>
            <h3>Payment Successful</h3>
            <p>Your payment of {fmt(breakdown?.totalCharged)} was received. A receipt has been recorded on your account.</p>
            <button className="spm-btn-pay" onClick={onClose}>Done</button>
          </div>
        )}

        {!loading && !initError && !paid && clientSecret && breakdown && (
          <Elements stripe={stripePromise} options={elementsOptions}>
            <CheckoutForm
              invoiceTotal={breakdown.invoiceTotal}
              fee={breakdown.fee}
              totalCharged={breakdown.totalCharged}
              onSuccess={handleSuccess}
              onCancel={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}

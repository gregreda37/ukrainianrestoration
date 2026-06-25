import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./SigningModal.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

const FIELD_COLORS = {
  signature: { border: "#2563eb", bg: "rgba(37,99,235,0.10)" },
  initials:  { border: "#16a34a", bg: "rgba(22,163,74,0.10)"  },
  date:      { border: "#d97706", bg: "rgba(217,119,6,0.10)"  },
  text:      { border: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
};

const today = () => new Date().toLocaleDateString("en-US", {
  month: "long", day: "numeric", year: "numeric",
});

function initPad(canvas, opts = {}) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width  = canvas.offsetWidth  * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  return new SignaturePad(canvas, {
    backgroundColor: "rgba(0,0,0,0)",
    penColor: "rgb(15, 23, 42)",
    minWidth: 1.5,
    maxWidth: 3,
    ...opts,
  });
}

export default function SigningModal({ todo, user, onSigned, onClose }) {
  const templateFields = (todo?.templateFields || []).filter(
    f => !f.signer || f.signer === "client"
  );
  const hasFields = templateFields.length > 0;

  // ── PDF state ──────────────────────────────────────────────────────────────
  const [pages,      setPages]      = useState([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError,   setPdfError]   = useState("");

  // ── Signing state ──────────────────────────────────────────────────────────
  const [signerName, setSignerName] = useState(user?.displayName || "");
  const [signing,    setSigning]    = useState(false);
  const [signError,  setSignError]  = useState("");
  const [signed,     setSigned]     = useState(false);

  // ── Top-bar pad refs ───────────────────────────────────────────────────────
  const sigCanvasRef  = useRef(null);
  const sigPadRef     = useRef(null);
  const initCanvasRef = useRef(null);
  const initPadRef    = useRef(null);

  // ── Template field values { [fieldId]: dataUrl | string } ─────────────────
  const [fieldValues, setFieldValues] = useState(() => {
    const vals = {};
    templateFields.forEach(f => {
      if (f.type === "date") vals[f.id] = today();
      if (f.type === "text") vals[f.id] = "";
    });
    return vals;
  });

  // Re-seed if todo.templateFields arrives after mount
  useEffect(() => {
    setFieldValues(prev => {
      const next = { ...prev };
      let changed = false;
      templateFields.forEach(f => {
        if (f.type === "date" && !next[f.id]) { next[f.id] = today(); changed = true; }
        if (f.type === "text" && next[f.id] === undefined) { next[f.id] = ""; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [todo?.templateFields]); // eslint-disable-line

  // ── Load PDF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!todo?.docusignUrl || !user) return;
    setPdfLoading(true);
    setPdfError("");
    (async () => {
      try {
        const token     = await user.getIdToken();
        const proxyResp = await fetch(`${API}/signing/proxy-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ url: todo.docusignUrl }),
        });
        if (!proxyResp.ok) throw new Error(`Proxy error ${proxyResp.status}`);
        const buf = await proxyResp.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/cmaps/",
          cMapPacked: true,
        }).promise;
        const rendered = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page     = await pdf.getPage(i);
          const scale    = Math.min(2, window.innerWidth > 600 ? 1.6 : 1.2);
          const viewport = page.getViewport({ scale });
          const canvas   = document.createElement("canvas");
          canvas.width   = viewport.width;
          canvas.height  = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          rendered.push(canvas.toDataURL("image/jpeg", 0.92));
        }
        setPages(rendered);
      } catch (err) {
        setPdfError("Could not load document: " + (err.message || "unknown error"));
      } finally {
        setPdfLoading(false);
      }
    })();
  }, [todo?.docusignUrl, user]); // eslint-disable-line

  // ── Init pads ──────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (sigCanvasRef.current)  sigPadRef.current  = initPad(sigCanvasRef.current);
    if (hasFields && initCanvasRef.current) initPadRef.current = initPad(initCanvasRef.current);
    const onResize = () => {
      if (sigCanvasRef.current)  sigPadRef.current  = initPad(sigCanvasRef.current);
      if (hasFields && initCanvasRef.current) initPadRef.current = initPad(initCanvasRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hasFields]);

  // ── Tap a PDF field → stamp the pre-drawn sig or initials ─────────────────
  const applyToField = (field) => {
    if (signed) return;
    if (field.type === "signature") {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        setSignError("Draw your signature above first, then tap the field to apply it.");
        return;
      }
      setFieldValues(prev => ({ ...prev, [field.id]: sigPadRef.current.toDataURL("image/png") }));
      setSignError("");
    } else if (field.type === "initials") {
      if (!initPadRef.current || initPadRef.current.isEmpty()) {
        setSignError("Draw your initials above first, then tap the field to apply it.");
        return;
      }
      setFieldValues(prev => ({ ...prev, [field.id]: initPadRef.current.toDataURL("image/png") }));
      setSignError("");
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!signerName.trim()) { setSignError("Please enter your full name."); return; }
    if (hasFields) {
      const unfilled = templateFields.filter(f => !isFieldFilled(f) && f.type !== "date");
      if (unfilled.length) {
        setSignError(`${unfilled.length} field${unfilled.length > 1 ? "s" : ""} still need your signature — tap each highlighted area on the document.`);
        return;
      }
    } else if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
      setSignError("Please draw your signature first.");
      return;
    }

    setSigning(true);
    setSignError("");

    let signerIp = "";
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
      signerIp = (await ipRes.json()).ip || "";
    } catch { /* proceed without IP */ }

    const auditMeta = {
      signerEmail: user.email        || "",
      signerPhone: user.phoneNumber  || "",
      signerIp,
      userAgent:   navigator.userAgent.slice(0, 200),
    };

    let payload;
    if (hasFields) {
      payload = {
        pdfUrl:     todo.docusignUrl,
        signerName: signerName.trim(),
        todoId:     todo.id,
        userId:     user.uid,
        docName:    todo.label || "document",
        fields:     templateFields.map(f => ({
          type: f.type, pageIndex: f.pageIndex,
          x: f.x, y: f.y, w: f.w, h: f.h,
          value: fieldValues[f.id] || "",
        })),
        ...auditMeta,
      };
    } else {
      payload = {
        pdfUrl:           todo.docusignUrl,
        signatureDataUrl: sigPadRef.current.toDataURL("image/png"),
        signerName:       signerName.trim(),
        todoId:           todo.id,
        userId:           user.uid,
        docName:          todo.label || "document",
        ...auditMeta,
      };
    }

    try {
      const token = await user.getIdToken();
      const resp  = await fetch(`${API}/signing/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Signing failed");
      setSigned(true);
      await onSigned(todo, result.signedDocumentUrl);
    } catch (err) {
      setSignError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSigning(false);
    }
  };

  const isFieldFilled = (f) => f.type === "text"
    ? !!fieldValues[f.id]?.trim()
    : !!fieldValues[f.id];
  const filledCount   = templateFields.filter(isFieldFilled).length;
  const autoCount     = templateFields.filter(f => f.type === "date").length;
  const requiredCount = templateFields.filter(f => f.type !== "date").length;
  const allDone       = filledCount >= templateFields.length;
  const remaining     = requiredCount - (filledCount - autoCount);

  return (
    <div className="sm-overlay">
      <div className="sm-modal">

        {/* ── Header ── */}
        <div className="sm-header">
          <div className="sm-header-info">
            <span className="sm-header-tag">Sign Document</span>
            <span className="sm-header-title">{todo?.label || "Document"}</span>
          </div>
          <button className="sm-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Top action bar — name · sig pad · initials pad · submit ── */}
        <div className="sm-top-bar">

          <div className="sm-top-name-group">
            <label className="sm-top-label">Full name</label>
            <input
              className="sm-name-input"
              type="text"
              placeholder="Your full name"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              disabled={signed}
            />
          </div>

          <div className="sm-top-pads">
            <div className="sm-pad-group">
              <div className="sm-pad-header">
                <span className="sm-pad-label">Signature</span>
                <button className="sm-clear-btn" type="button"
                  onClick={() => sigPadRef.current?.clear()}>Clear</button>
              </div>
              <div className="sm-canvas-wrap">
                <canvas ref={sigCanvasRef} className="sm-canvas" />
                <span className="sm-canvas-hint">
                  {hasFields ? "Draw once, tap fields to apply" : "Draw your signature"}
                </span>
              </div>
            </div>

            {hasFields && (
              <div className="sm-pad-group sm-pad-group--sm">
                <div className="sm-pad-header">
                  <span className="sm-pad-label">Initials</span>
                  <button className="sm-clear-btn" type="button"
                    onClick={() => initPadRef.current?.clear()}>Clear</button>
                </div>
                <div className="sm-canvas-wrap sm-canvas-wrap--sm">
                  <canvas ref={initCanvasRef} className="sm-canvas" />
                  <span className="sm-canvas-hint">Draw once, tap fields to apply</span>
                </div>
              </div>
            )}
          </div>

          <div className="sm-top-submit-group">
            {hasFields && (
              <>
                <div className="sm-field-progress">
                  <div className="sm-field-progress-bar"
                    style={{ width: `${templateFields.length ? (filledCount / templateFields.length) * 100 : 0}%` }} />
                </div>
                <p className="sm-field-progress-label">
                  {filledCount}/{templateFields.length} complete
                  {autoCount > 0 && ` · ${autoCount} auto-filled`}
                </p>
              </>
            )}
            {signError && <p className="sm-error">{signError}</p>}
            {signed ? (
              <div className="sm-success">✓ Document signed successfully</div>
            ) : (
              <button
                className="sm-submit-btn"
                onClick={submit}
                disabled={signing || pdfLoading || (hasFields && !allDone)}
              >
                {signing
                  ? <><span className="sm-btn-spinner" /> Processing…</>
                  : hasFields && !allDone
                    ? `${remaining} field${remaining !== 1 ? "s" : ""} remaining`
                    : "Submit Signature"}
              </button>
            )}
          </div>

        </div>

        {/* ── PDF panel (full width, scrollable) ── */}
        <div className="sm-pdf-panel">
          {pdfLoading && (
            <div className="sm-pdf-state">
              <div className="sm-spinner" />
              <span>Loading document…</span>
            </div>
          )}
          {pdfError && <div className="sm-pdf-state sm-pdf-err">⚠ {pdfError}</div>}

          {!pdfLoading && !pdfError && pages.map((src, pageIdx) => (
            <div key={pageIdx} className="sm-page-wrap">
              <img src={src} alt={`Page ${pageIdx + 1}`} className="sm-pdf-page" />

              {templateFields
                .filter(f => f.pageIndex === pageIdx)
                .map(field => {
                  const c      = FIELD_COLORS[field.type];
                  const filled = !!fieldValues[field.id];
                  return (
                    <div
                      key={field.id}
                      className={`sm-field-overlay sm-field--${field.type} ${filled ? "sm-field--filled" : "sm-field--empty"}`}
                      style={{
                        left:            `${field.x * 100}%`,
                        top:             `${field.y * 100}%`,
                        width:           `${field.w * 100}%`,
                        height:          `${field.h * 100}%`,
                        borderColor:     c.border,
                        backgroundColor: filled ? "transparent" : c.bg,
                        cursor: (field.type === "signature" || field.type === "initials")
                          ? "pointer" : "default",
                      }}
                      onClick={() => applyToField(field)}
                    >
                      {field.type === "date" ? (
                        <span className="sm-field-date-text" style={{ color: "#92400e" }}>
                          {fieldValues[field.id]}
                        </span>
                      ) : field.type === "text" ? (
                        <input
                          className="sm-field-text-input"
                          placeholder="Type here…"
                          value={fieldValues[field.id] || ""}
                          onChange={e => setFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          disabled={signed}
                          style={{ color: c.border }}
                        />
                      ) : filled ? (
                        <img src={fieldValues[field.id]} className="sm-field-sig-img" alt="" />
                      ) : (
                        <span className="sm-field-empty-label" style={{ color: c.border }}>
                          {field.type === "signature" ? "✍ Tap to sign" : "✒ Tap to initial"}
                        </span>
                      )}
                    </div>
                  );
                })
              }
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

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
    backgroundColor: "rgb(255,255,255)",
    penColor: "rgb(15, 23, 42)",
    minWidth: 1.5,
    maxWidth: 3,
    ...opts,
  });
}

export default function SigningModal({ todo, user, onSigned, onClose }) {
  const templateFields = todo?.templateFields || [];
  const hasFields      = templateFields.length > 0;

  // ── PDF state ──────────────────────────────────────────────────────────────
  const [pages,      setPages]      = useState([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError,   setPdfError]   = useState("");

  // ── Signing state ──────────────────────────────────────────────────────────
  const [signerName, setSignerName] = useState(user?.displayName || "");
  const [signing,    setSigning]    = useState(false);
  const [signError,  setSignError]  = useState("");
  const [signed,     setSigned]     = useState(false);

  // ── Legacy (no template) sig pad ───────────────────────────────────────────
  const sigCanvasRef = useRef(null);
  const sigPadRef    = useRef(null);

  // ── Template field values { [fieldId]: dataUrl | dateString } ─────────────
  const [fieldValues, setFieldValues] = useState(() => {
    const vals = {};
    templateFields.forEach(f => {
      if (f.type === "date") vals[f.id] = today();
    });
    return vals;
  });

  // ── Mini pad (for clicking a field on the PDF) ─────────────────────────────
  const [activeField,  setActiveField]  = useState(null);
  const miniCanvasRef = useRef(null);
  const miniPadRef    = useRef(null);

  // ── Load PDF via backend proxy ─────────────────────────────────────────────
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

  // ── Legacy sig pad init ────────────────────────────────────────────────────
  useEffect(() => {
    if (hasFields || !sigCanvasRef.current) return;
    const canvas = sigCanvasRef.current;
    sigPadRef.current = initPad(canvas);
    const onResize = () => {
      sigPadRef.current = initPad(canvas);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hasFields]);

  // ── Mini pad init (runs after activeField renders the canvas) ──────────────
  useLayoutEffect(() => {
    if (!activeField || !miniCanvasRef.current) return;
    miniPadRef.current = initPad(miniCanvasRef.current);
  }, [activeField]);

  const applyField = () => {
    if (!miniPadRef.current || miniPadRef.current.isEmpty()) return;
    setFieldValues(prev => ({ ...prev, [activeField.id]: miniPadRef.current.toDataURL("image/png") }));
    setActiveField(null);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!signerName.trim()) { setSignError("Please enter your full name."); return; }

    let payload;

    if (hasFields) {
      const unfilled = templateFields.filter(f => f.type !== "date" && !fieldValues[f.id]);
      if (unfilled.length) {
        setSignError(`${unfilled.length} field${unfilled.length > 1 ? "s" : ""} still need your signature — click each highlighted area on the document.`);
        return;
      }
      payload = {
        pdfUrl:      todo.docusignUrl,
        signerName:  signerName.trim(),
        todoId:      todo.id,
        userId:      user.uid,
        docName:     todo.label || "document",
        fields:      templateFields.map(f => ({
          type:      f.type,
          pageIndex: f.pageIndex,
          x: f.x, y: f.y, w: f.w, h: f.h,
          value:     fieldValues[f.id] || "",
        })),
      };
    } else {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        setSignError("Please draw your signature first.");
        return;
      }
      payload = {
        pdfUrl:           todo.docusignUrl,
        signatureDataUrl: sigPadRef.current.toDataURL("image/png"),
        signerName:       signerName.trim(),
        todoId:           todo.id,
        userId:           user.uid,
        docName:          todo.label || "document",
      };
    }

    setSigning(true);
    setSignError("");
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

  const filledCount   = templateFields.filter(f => fieldValues[f.id]).length;
  const requiredCount = templateFields.filter(f => f.type !== "date").length;
  const autoCount     = templateFields.filter(f => f.type === "date").length;
  const allDone       = filledCount >= templateFields.length;

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

        <div className="sm-body">

          {/* ── PDF panel ── */}
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

                {/* Field overlays */}
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
                          backgroundColor: filled ? "rgba(255,255,255,0.85)" : c.bg,
                          cursor:          field.type === "date" ? "default" : "pointer",
                        }}
                        onClick={() => field.type !== "date" && !signed && setActiveField(field)}
                      >
                        {field.type === "date" ? (
                          <span className="sm-field-date-text" style={{ color: "#92400e" }}>
                            {fieldValues[field.id]}
                          </span>
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

          {/* ── Right panel ── */}
          <div className="sm-sig-panel">
            <div className="sm-sig-card">

              {hasFields ? (
                /* Template mode — field checklist */
                <>
                  <p className="sm-sig-label">Signing checklist</p>
                  <p className="sm-field-hint">Click each highlighted area on the document to add your signature or initials.</p>
                  <div className="sm-field-list">
                    {templateFields.map(f => {
                      const filled = !!fieldValues[f.id];
                      return (
                        <div
                          key={f.id}
                          className={`sm-field-item ${filled ? "sm-field-item--done" : "sm-field-item--todo"} ${f.type === "date" ? "sm-field-item--auto" : ""}`}
                          onClick={() => f.type !== "date" && !signed && setActiveField(f)}
                          style={{ cursor: f.type === "date" ? "default" : "pointer" }}
                        >
                          <span className="sm-field-item-icon">{filled ? "✓" : f.type === "date" ? "📅" : f.type === "signature" ? "✍" : "✒"}</span>
                          <div className="sm-field-item-info">
                            <span className="sm-field-item-type">
                              {f.type === "signature" ? "Signature" : f.type === "initials" ? "Initials" : "Date"}
                            </span>
                            <span className="sm-field-item-page">Page {f.pageIndex + 1}</span>
                          </div>
                          {f.type === "date" && <span className="sm-field-item-auto">Auto</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="sm-field-progress">
                    <div className="sm-field-progress-bar"
                      style={{ width: `${templateFields.length ? (filledCount / templateFields.length) * 100 : 0}%` }} />
                  </div>
                  <p className="sm-field-progress-label">
                    {filledCount}/{templateFields.length} complete
                    {autoCount > 0 && ` (${autoCount} auto-filled)`}
                  </p>
                </>
              ) : (
                /* Legacy mode — draw sig in right panel */
                <>
                  <div className="sm-sig-row">
                    <span className="sm-sig-label">Your signature</span>
                    <button className="sm-clear-btn" type="button"
                      onClick={() => sigPadRef.current?.clear()}>Clear</button>
                  </div>
                  <div className="sm-canvas-wrap">
                    <canvas ref={sigCanvasRef} className="sm-canvas" />
                    <span className="sm-canvas-hint">Draw your signature above</span>
                  </div>
                </>
              )}

              <div className="sm-name-row">
                <label className="sm-name-label">Full name</label>
                <input
                  className="sm-name-input"
                  type="text"
                  placeholder="Type your full name"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  disabled={signed}
                />
              </div>

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
                      ? `${requiredCount - (filledCount - autoCount)} field${requiredCount - (filledCount - autoCount) > 1 ? "s" : ""} remaining`
                      : "Submit Signature"}
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Mini signature pad modal ── */}
      {activeField && (
        <div className="sm-mini-overlay" onClick={() => setActiveField(null)}>
          <div className="sm-mini-modal" onClick={e => e.stopPropagation()}>
            <div className="sm-mini-header">
              <span>{activeField.type === "initials" ? "Draw your initials" : "Draw your signature"}</span>
              <button className="sm-mini-close" onClick={() => setActiveField(null)}>✕</button>
            </div>
            <div className="sm-mini-canvas-wrap">
              <canvas ref={miniCanvasRef} className="sm-mini-canvas" />
              <span className="sm-canvas-hint">
                {activeField.type === "initials" ? "Draw your initials" : "Sign above"}
              </span>
            </div>
            <div className="sm-mini-actions">
              <button className="sm-clear-btn" onClick={() => miniPadRef.current?.clear()}>Clear</button>
              <button className="sm-apply-btn" onClick={applyField}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

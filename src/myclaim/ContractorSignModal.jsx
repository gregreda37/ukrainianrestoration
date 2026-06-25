import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import TemplateBuilder from "./TemplateBuilder";
import "./ContractorSignModal.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

const FIELD_COLORS = {
  signature: { border: "#1e3a8a", bg: "transparent"              },
  initials:  { border: "#14532d", bg: "transparent"              },
  date:      { border: "#92400e", bg: "rgba(146,64,14,0.08)"    },
  text:      { border: "#5b21b6", bg: "rgba(91,33,182,0.08)"    },
};

function initPad(canvas, opts = {}) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width  = canvas.offsetWidth  * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  return new SignaturePad(canvas, {
    backgroundColor: "rgba(0,0,0,0)",
    penColor: "rgb(10, 40, 10)",
    minWidth: 1.5,
    maxWidth: 3,
    ...opts,
  });
}

const todayStr = () => new Date().toLocaleDateString("en-US", {
  month: "long", day: "numeric", year: "numeric",
});

export default function ContractorSignModal({ todo, clientUid, user, onCounterSigned, onClose }) {
  const contractorFields = (todo?.templateFields || []).filter(f => f.signer === "contractor");
  const hasTemplateFields = contractorFields.length > 0;

  const [pages,           setPages]           = useState([]);
  const [pdfLoading,      setPdfLoading]      = useState(true);
  const [pdfError,        setPdfError]        = useState("");
  const [contractorName,  setContractorName]  = useState(user?.displayName || "");
  const [signing,         setSigning]         = useState(false);
  const [signError,       setSignError]       = useState("");
  const [done,            setDone]            = useState(false);
  const [saveDefault,     setSaveDefault]     = useState(false);
  // Ad-hoc field placement when template has no contractor fields
  const [adHocFields,     setAdHocFields]     = useState(null);
  const [showFieldPlacer, setShowFieldPlacer] = useState(false);

  // Saved defaults from Firestore
  const [savedSigUrl,      setSavedSigUrl]      = useState(null);
  const [savedInitialsUrl, setSavedInitialsUrl] = useState(null);

  // Live preview URLs updated via endStroke
  const [sigPreviewUrl,  setSigPreviewUrl]  = useState(null);
  const [initPreviewUrl, setInitPreviewUrl] = useState(null);

  // Field values — tracks what has been applied to each field on the PDF
  const [fieldValues, setFieldValues] = useState(() => {
    const vals = {};
    contractorFields.forEach(f => {
      if (f.type === "date") vals[f.id] = todayStr();
      if (f.type === "text") vals[f.id] = "";
    });
    return vals;
  });

  const sigCanvasRef  = useRef(null);
  const sigPadRef     = useRef(null);
  const initCanvasRef = useRef(null);
  const initPadRef    = useRef(null);

  // Ad-hoc fields override template fields; falls back to template contractor fields
  const effectiveContractorFields = adHocFields !== null ? adHocFields : contractorFields;
  const hasEffectiveFields = effectiveContractorFields.length > 0;

  // ── Load saved sig + initials ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid, "contractorProfile", "signature"));
        if (snap.exists()) {
          const d = snap.data();
          if (d.dataUrl)     setSavedSigUrl(d.dataUrl);
          if (d.initialsUrl) setSavedInitialsUrl(d.initialsUrl);
          if (d.name)        setContractorName(d.name);
        }
      } catch {}
    })();
  }, [user]);

  // ── Load signed PDF ─────────────────────────────────────────────────────────
  useEffect(() => {
    const pdfUrl = todo?.signedDocumentUrl;
    if (!pdfUrl || !user) return;
    setPdfLoading(true);
    setPdfError("");
    (async () => {
      try {
        const token = await user.getIdToken();
        let proxyResp;
        try {
          proxyResp = await fetch(`${API}/signing/proxy-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ url: pdfUrl }),
          });
        } catch (netErr) {
          throw new Error(`Network error — could not reach server (${netErr.message})`);
        }
        if (!proxyResp.ok) {
          const body = await proxyResp.json().catch(() => ({}));
          throw new Error(`Server error ${proxyResp.status}: ${body.error || proxyResp.statusText}`);
        }
        const buf = await proxyResp.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/cmaps/",
          cMapPacked: true,
        }).promise;
        const rendered = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page     = await pdf.getPage(i);
          const scale    = Math.min(2, window.innerWidth > 600 ? 1.5 : 1.2);
          const viewport = page.getViewport({ scale });
          const canvas   = document.createElement("canvas");
          canvas.width   = viewport.width;
          canvas.height  = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          rendered.push(canvas.toDataURL("image/jpeg", 0.92));
        }
        setPages(rendered);
      } catch (err) {
        setPdfError("Could not load document: " + err.message);
      } finally {
        setPdfLoading(false);
      }
    })();
  }, [todo?.signedDocumentUrl, user]); // eslint-disable-line

  // ── Init pads + live preview via endStroke ──────────────────────────────────
  useLayoutEffect(() => {
    const setup = (canvasRef, padRef, setPreview) => {
      if (!canvasRef.current) return;
      const pad = initPad(canvasRef.current);
      padRef.current = pad;
      pad.addEventListener("endStroke", () => {
        setPreview(pad.toDataURL("image/png"));
      });
    };
    setup(sigCanvasRef,  sigPadRef,  setSigPreviewUrl);
    setup(initCanvasRef, initPadRef, setInitPreviewUrl);
    const onResize = () => {
      setup(sigCanvasRef,  sigPadRef,  setSigPreviewUrl);
      setup(initCanvasRef, initPadRef, setInitPreviewUrl);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clearSig = () => { sigPadRef.current?.clear(); setSigPreviewUrl(null); };
  const clearInitials = () => { initPadRef.current?.clear(); setInitPreviewUrl(null); };

  // Active data URLs: drawn pad takes priority over saved default
  const activeSigUrl      = sigPreviewUrl      || savedSigUrl;
  const activeInitialsUrl = initPreviewUrl     || savedInitialsUrl;

  // ── Tap a PDF field to apply sig/initials ───────────────────────────────────
  const applyToField = (field) => {
    if (done) return;
    if (field.type === "signature") {
      if (!activeSigUrl) {
        setSignError("Draw your signature above first, then tap the field.");
        return;
      }
      setFieldValues(prev => ({ ...prev, [field.id]: activeSigUrl }));
      setSignError("");
    } else if (field.type === "initials") {
      if (!activeInitialsUrl && !activeSigUrl) {
        setSignError("Draw your initials (or signature) above first, then tap the field.");
        return;
      }
      setFieldValues(prev => ({ ...prev, [field.id]: activeInitialsUrl || activeSigUrl }));
      setSignError("");
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!contractorName.trim()) { setSignError("Enter your name."); return; }
    if (!activeSigUrl) { setSignError("Draw or confirm your signature above."); return; }

    const emptyText = effectiveContractorFields.filter(
      f => f.type === "text" && !(fieldValues[f.id] || "").trim()
    );
    if (emptyText.length) {
      setSignError(`Fill in ${emptyText.length} text field${emptyText.length > 1 ? "s" : ""} on the document.`);
      return;
    }

    setSigning(true);
    setSignError("");

    let contractorIp = "";
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
      contractorIp = (await ipRes.json()).ip || "";
    } catch {}

    // Auto-fill any sig/initials/date fields not individually tapped
    const finalValues = { ...fieldValues };
    effectiveContractorFields.forEach(f => {
      if (f.type === "signature" && !finalValues[f.id]) finalValues[f.id] = activeSigUrl;
      if (f.type === "initials"  && !finalValues[f.id]) finalValues[f.id] = activeInitialsUrl || activeSigUrl;
      if (f.type === "date"      && !finalValues[f.id]) finalValues[f.id] = todayStr();
    });

    const ctrFieldsWithValues = effectiveContractorFields.map(f => ({
      type: f.type, pageIndex: f.pageIndex,
      x: f.x, y: f.y, w: f.w, h: f.h,
      value: finalValues[f.id] || "",
    }));

    try {
      const token = await user.getIdToken();

      if (saveDefault) {
        await setDoc(doc(db, "users", user.uid, "contractorProfile", "signature"), {
          dataUrl:     activeSigUrl,
          initialsUrl: activeInitialsUrl || null,
          name:        contractorName.trim(),
        });
      }

      const resp = await fetch(`${API}/signing/contractor-sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          signedPdfUrl:     todo.signedDocumentUrl,
          contractorName:   contractorName.trim(),
          contractorEmail:  user.email || "",
          contractorIp,
          signatureDataUrl: activeSigUrl,
          // Send fields when available (template or ad-hoc); null triggers legacy block
          contractorFields: hasEffectiveFields ? ctrFieldsWithValues : null,
          todoId:           todo.id,
          clientUid,
          docName:          todo.label || "document",
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Counter-signing failed");

      await onCounterSigned(todo, result.contractorSignedDocUrl, result.clientDocUrl);
      setDone(true);
    } catch (err) {
      setSignError(err.message || "Something went wrong.");
    } finally {
      setSigning(false);
    }
  };

  const isFieldFilled = (f) => f.type === "text"
    ? !!fieldValues[f.id]?.trim()
    : !!fieldValues[f.id];
  const filledCount = effectiveContractorFields.filter(isFieldFilled).length;
  const autoCount   = effectiveContractorFields.filter(f => f.type === "date").length;

  return (
    <div className="csm-overlay">
      <div className="csm-modal">

        {/* ── Header ── */}
        <div className="csm-header">
          <div className="csm-header-info">
            <span className="csm-tag">Contractor Review</span>
            <span className="csm-title">{todo?.label || "Document"}</span>
          </div>
          <button className="csm-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Top action bar ── */}
        <div className="csm-top-bar">

          <div className="csm-top-name-group">
            <label className="csm-top-label">Full name</label>
            <input
              className="csm-name-input"
              type="text"
              placeholder="Your name"
              value={contractorName}
              onChange={e => setContractorName(e.target.value)}
              disabled={done}
            />
          </div>

          <div className="csm-top-pads">

            {/* Signature pad */}
            <div className="csm-pad-group">
              <div className="csm-pad-header">
                <span className="csm-pad-label">
                  Signature
                  {savedSigUrl && !sigPreviewUrl && <span className="csm-saved-badge">Saved</span>}
                </span>
                <button className="csm-clear-btn" type="button" onClick={clearSig}>Clear</button>
              </div>
              {(sigPreviewUrl || (savedSigUrl && !sigPreviewUrl)) && (
                <img src={sigPreviewUrl || savedSigUrl} className="csm-sig-preview" alt="sig preview" />
              )}
              <div className="csm-canvas-wrap">
                <canvas ref={sigCanvasRef} className="csm-canvas" />
                <span className="csm-canvas-hint">
                  {savedSigUrl && !sigPreviewUrl
                    ? "Draw to replace saved signature"
                    : "Draw once · tap signature fields below to apply"}
                </span>
              </div>
            </div>

            {/* Initials pad */}
            <div className="csm-pad-group csm-pad-group--sm">
              <div className="csm-pad-header">
                <span className="csm-pad-label">
                  Initials
                  {savedInitialsUrl && !initPreviewUrl && <span className="csm-saved-badge">Saved</span>}
                </span>
                <button className="csm-clear-btn" type="button" onClick={clearInitials}>Clear</button>
              </div>
              {(initPreviewUrl || (savedInitialsUrl && !initPreviewUrl)) && (
                <img src={initPreviewUrl || savedInitialsUrl} className="csm-sig-preview" alt="initials preview" />
              )}
              <div className="csm-canvas-wrap csm-canvas-wrap--sm">
                <canvas ref={initCanvasRef} className="csm-canvas" />
                <span className="csm-canvas-hint">
                  {savedInitialsUrl && !initPreviewUrl
                    ? "Draw to replace saved"
                    : "Draw once · tap initials fields below"}
                </span>
              </div>
            </div>

          </div>

          {/* Submit */}
          <div className="csm-top-submit-group">
            {hasEffectiveFields && (
              <>
                <div className="csm-field-progress">
                  <div className="csm-field-progress-bar"
                    style={{ width: `${effectiveContractorFields.length ? (filledCount / effectiveContractorFields.length) * 100 : 0}%` }} />
                </div>
                <p className="csm-field-progress-label">
                  {filledCount}/{effectiveContractorFields.length} fields applied
                  {autoCount > 0 && ` · ${autoCount} auto-filled`}
                  {adHocFields !== null && (
                    <button className="csm-replace-fields-btn"
                      onClick={() => setShowFieldPlacer(true)}>Edit</button>
                  )}
                </p>
              </>
            )}
            {!hasEffectiveFields && (
              <div className="csm-no-fields-wrap">
                <p className="csm-no-fields-note">
                  No contractor fields — place signature fields on the document, or a default block will be added.
                </p>
                {!done && (
                  <button className="csm-place-fields-btn"
                    onClick={() => setShowFieldPlacer(true)}>
                    Place Signature Fields
                  </button>
                )}
              </div>
            )}
            <label className="csm-save-row">
              <input
                type="checkbox"
                checked={saveDefault}
                onChange={e => setSaveDefault(e.target.checked)}
                disabled={done}
              />
              <span>Save as my default</span>
            </label>
            {signError && <p className="csm-error">{signError}</p>}
            {done ? (
              <div className="csm-success">✓ Countersigned and saved to client files</div>
            ) : (
              <button className="csm-submit-btn" onClick={submit} disabled={signing || pdfLoading}>
                {signing
                  ? <><span className="csm-spinner-sm" /> Processing…</>
                  : "Approve & Counter-Sign"}
              </button>
            )}
          </div>

        </div>

        {/* ── PDF panel with contractor field overlays ── */}
        <div className="csm-pdf-panel">
          {pdfLoading && (
            <div className="csm-state"><div className="csm-spinner" /><span>Loading document…</span></div>
          )}
          {pdfError && <div className="csm-state csm-err">⚠ {pdfError}</div>}

          {!pdfLoading && !pdfError && pages.map((src, pageIdx) => (
            <div key={pageIdx} className="csm-page-wrap">
              <img src={src} alt={`Page ${pageIdx + 1}`} className="csm-page-img" />

              {effectiveContractorFields
                .filter(f => f.pageIndex === pageIdx)
                .map(field => {
                  const c      = FIELD_COLORS[field.type];
                  const filled = !!fieldValues[field.id];
                  const interactive = field.type === "signature" || field.type === "initials";
                  return (
                    <div
                      key={field.id}
                      className={`csm-field-overlay${filled ? " csm-field--filled" : ""}${interactive ? " csm-field--interactive" : ""}`}
                      style={{
                        left:            `${field.x * 100}%`,
                        top:             `${field.y * 100}%`,
                        width:           `${field.w * 100}%`,
                        height:          `${field.h * 100}%`,
                        borderColor:     c.border,
                        backgroundColor: filled ? "transparent" : c.bg,
                        cursor:          interactive && !done ? "pointer" : "default",
                      }}
                      onClick={() => interactive && applyToField(field)}
                    >
                      {field.type === "text" ? (
                        <input
                          className="csm-field-text-input"
                          placeholder="Type here…"
                          value={fieldValues[field.id] || ""}
                          onChange={e => setFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          disabled={done}
                          style={{ color: c.border }}
                        />
                      ) : field.type === "date" ? (
                        <span className="csm-field-label" style={{ color: c.border }}>
                          {fieldValues[field.id] || todayStr()}
                        </span>
                      ) : filled ? (
                        <img src={fieldValues[field.id]} className="csm-field-sig-img" alt="" />
                      ) : (
                        <span className="csm-field-label" style={{ color: c.border }}>
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

      {/* ── Ad-hoc field placement overlay ── */}
      {showFieldPlacer && (
        <TemplateBuilder
          existingTemplate={adHocFields !== null
            ? { pdfUrl: todo.signedDocumentUrl, fields: adHocFields }
            : { pdfUrl: todo.signedDocumentUrl }
          }
          oneTime={true}
          user={user}
          orgId={null}
          onSave={({ fields }) => {
            // All fields placed here are contractor fields, regardless of signer toggle
            setAdHocFields(fields.map(f => ({ ...f, signer: "contractor" })));
            setShowFieldPlacer(false);
          }}
          onClose={() => setShowFieldPlacer(false)}
        />
      )}
    </div>
  );
}

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import "./ContractorSignModal.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

function initPad(canvas) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width  = canvas.offsetWidth  * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  return new SignaturePad(canvas, {
    backgroundColor: "rgb(255,255,255)",
    penColor: "rgb(10, 40, 10)",
    minWidth: 1.5,
    maxWidth: 3,
  });
}

export default function ContractorSignModal({ todo, clientUid, user, onCounterSigned, onClose }) {
  const [pages,          setPages]          = useState([]);
  const [pdfLoading,     setPdfLoading]     = useState(true);
  const [pdfError,       setPdfError]       = useState("");
  const [contractorName, setContractorName] = useState(user?.displayName || "");
  const [signing,        setSigning]        = useState(false);
  const [signError,      setSignError]      = useState("");
  const [done,           setDone]           = useState(false);
  const [saveDefault,    setSaveDefault]    = useState(false);
  const [savedSigUrl,    setSavedSigUrl]    = useState(null); // pre-stored sig data URL

  const canvasRef = useRef(null);
  const padRef    = useRef(null);

  // Load contractor's saved signature from Firestore profile
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid, "contractorProfile", "signature"));
        if (snap.exists()) {
          const d = snap.data();
          if (d.dataUrl) setSavedSigUrl(d.dataUrl);
          if (d.name)    setContractorName(d.name);
        }
      } catch {}
    })();
  }, [user]);

  // Load the signed PDF for preview
  useEffect(() => {
    const pdfUrl = todo?.signedDocumentUrl;
    if (!pdfUrl || !user) return;
    setPdfLoading(true);
    setPdfError("");
    (async () => {
      try {
        const token     = await user.getIdToken();
        const proxyResp = await fetch(`${API}/signing/proxy-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ url: pdfUrl }),
        });
        if (!proxyResp.ok) throw new Error(`Proxy ${proxyResp.status}`);
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

  // Init signature pad
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    padRef.current = initPad(canvasRef.current);
    const onResize = () => { padRef.current = initPad(canvasRef.current); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const getSignatureDataUrl = () => {
    if (savedSigUrl && (!padRef.current || padRef.current.isEmpty())) return savedSigUrl;
    if (padRef.current && !padRef.current.isEmpty()) return padRef.current.toDataURL("image/png");
    return null;
  };

  const submit = async () => {
    if (!contractorName.trim()) { setSignError("Enter your name."); return; }
    const sigDataUrl = getSignatureDataUrl();
    if (!sigDataUrl) { setSignError("Draw or confirm your signature."); return; }

    setSigning(true);
    setSignError("");
    try {
      const token = await user.getIdToken();

      // Optionally save contractor's signature to profile
      if (saveDefault) {
        await setDoc(doc(db, "users", user.uid, "contractorProfile", "signature"), {
          dataUrl: sigDataUrl,
          name:    contractorName.trim(),
        });
      }

      const resp = await fetch(`${API}/signing/contractor-sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          signedPdfUrl:    todo.signedDocumentUrl,
          contractorName:  contractorName.trim(),
          signatureDataUrl: sigDataUrl,
          todoId:          todo.id,
          clientUid,
          docName:         todo.label || "document",
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Counter-signing failed");

      setDone(true);
      await onCounterSigned(todo, result.contractorSignedDocUrl, result.clientDocUrl);
    } catch (err) {
      setSignError(err.message || "Something went wrong.");
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="csm-overlay">
      <div className="csm-modal">

        <div className="csm-header">
          <div className="csm-header-info">
            <span className="csm-tag">Contractor Review</span>
            <span className="csm-title">{todo?.label || "Document"}</span>
          </div>
          <button className="csm-close" onClick={onClose}>✕</button>
        </div>

        <div className="csm-body">

          {/* PDF preview */}
          <div className="csm-pdf-panel">
            {pdfLoading && (
              <div className="csm-state"><div className="csm-spinner" /><span>Loading…</span></div>
            )}
            {pdfError && <div className="csm-state csm-err">⚠ {pdfError}</div>}
            {!pdfLoading && !pdfError && pages.map((src, i) => (
              <div key={i} className="csm-page-wrap">
                <img src={src} alt={`Page ${i + 1}`} className="csm-page-img" />
              </div>
            ))}
          </div>

          {/* Sign panel */}
          <div className="csm-sig-panel">
            <div className="csm-sig-card">
              <p className="csm-sig-heading">Contractor authorization</p>
              <p className="csm-sig-hint">
                Review the client-signed document, then add your approval signature below.
              </p>

              {savedSigUrl && (padRef.current?.isEmpty?.() !== false) && (
                <div className="csm-saved-sig">
                  <span className="csm-saved-label">Saved signature</span>
                  <img src={savedSigUrl} className="csm-saved-img" alt="saved sig" />
                  <p className="csm-saved-note">Draw below to override</p>
                </div>
              )}

              <div className="csm-canvas-header">
                <span className="csm-canvas-label">{savedSigUrl ? "Override signature" : "Your signature"}</span>
                <button className="csm-clear-btn" onClick={() => padRef.current?.clear()}>Clear</button>
              </div>
              <div className="csm-canvas-wrap">
                <canvas ref={canvasRef} className="csm-canvas" />
                <span className="csm-canvas-hint">Sign above</span>
              </div>

              <div className="csm-name-row">
                <label className="csm-name-label">Full name</label>
                <input
                  className="csm-name-input"
                  type="text"
                  placeholder="Your name"
                  value={contractorName}
                  onChange={e => setContractorName(e.target.value)}
                  disabled={done}
                />
              </div>

              <label className="csm-save-row">
                <input
                  type="checkbox"
                  checked={saveDefault}
                  onChange={e => setSaveDefault(e.target.checked)}
                  disabled={done}
                />
                <span>Save as my default signature</span>
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
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./SigningModal.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

export default function SigningModal({ todo, user, onSigned, onClose }) {
  const sigCanvasRef    = useRef(null);
  const sigPadRef       = useRef(null);
  const [pages,         setPages]         = useState([]);   // data URLs for each rendered page
  const [pdfLoading,    setPdfLoading]    = useState(true);
  const [pdfError,      setPdfError]      = useState("");
  const [signerName,    setSignerName]    = useState(user?.displayName || "");
  const [signing,       setSigning]       = useState(false);
  const [signError,     setSignError]     = useState("");
  const [signed,        setSigned]        = useState(false);

  // ── Load + render all PDF pages to data URLs ───────────────────────────
  useEffect(() => {
    if (!todo?.docusignUrl || !user) return;
    setPdfLoading(true);
    setPdfError("");

    const loadPdf = async () => {
      try {
        // Proxy through our backend to avoid Firebase Storage CORS restrictions
        const token = await user.getIdToken();
        const proxyResp = await fetch(`${API}/signing/proxy-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ url: todo.docusignUrl }),
        });
        if (!proxyResp.ok) throw new Error(`Proxy error ${proxyResp.status}`);
        const arrayBuffer = await proxyResp.arrayBuffer();

        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/",
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
    };
    loadPdf();
  }, [todo?.docusignUrl, user]); // eslint-disable-line

  // ── Init signature pad ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sigCanvasRef.current) return;
    const canvas = sigCanvasRef.current;

    const initPad = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width  = canvas.offsetWidth  * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d").scale(ratio, ratio);
      if (sigPadRef.current) sigPadRef.current.clear();
    };

    sigPadRef.current = new SignaturePad(canvas, {
      backgroundColor: "rgb(255,255,255)",
      penColor: "rgb(15, 23, 42)",
      minWidth: 1.5,
      maxWidth: 3,
    });

    initPad();
    window.addEventListener("resize", initPad);
    return () => window.removeEventListener("resize", initPad);
  }, []);

  const clearSig = () => sigPadRef.current?.clear();

  // ── Submit ─────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
      setSignError("Please draw your signature first.");
      return;
    }
    if (!signerName.trim()) {
      setSignError("Please enter your full name.");
      return;
    }

    setSigning(true);
    setSignError("");

    try {
      const signatureDataUrl = sigPadRef.current.toDataURL("image/png");
      const token = await user.getIdToken();

      const resp = await fetch(`${API}/signing/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          pdfUrl:           todo.docusignUrl,
          signatureDataUrl,
          signerName:       signerName.trim(),
          todoId:           todo.id,
          userId:           user.uid,
          docName:          todo.label || "document",
        }),
      });

      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Signing failed");

      setSigned(true);
      await onSigned(todo, result.signedDocumentUrl);
    } catch (err) {
      console.error("sign error:", err);
      setSignError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="sm-overlay">
      <div className="sm-modal">

        {/* ── Header ── */}
        <div className="sm-header">
          <div className="sm-header-info">
            <span className="sm-header-tag">Sign Document</span>
            <span className="sm-header-title">{todo?.label || "Document"}</span>
          </div>
          <button className="sm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sm-body">

          {/* ── PDF viewer ── */}
          <div className="sm-pdf-panel">
            {pdfLoading && (
              <div className="sm-pdf-state">
                <div className="sm-spinner" />
                <span>Loading document…</span>
              </div>
            )}
            {pdfError && (
              <div className="sm-pdf-state sm-pdf-err">
                <span>⚠ {pdfError}</span>
              </div>
            )}
            {!pdfLoading && !pdfError && pages.map((src, i) => (
              <img key={i} src={src} alt={`Page ${i + 1}`} className="sm-pdf-page" />
            ))}
          </div>

          {/* ── Signature panel ── */}
          <div className="sm-sig-panel">
            <div className="sm-sig-card">
              <div className="sm-sig-row">
                <span className="sm-sig-label">Your signature</span>
                <button className="sm-clear-btn" type="button" onClick={clearSig}>Clear</button>
              </div>
              <div className="sm-canvas-wrap">
                <canvas ref={sigCanvasRef} className="sm-canvas" />
                <span className="sm-canvas-hint">Draw your signature above</span>
              </div>
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
                  disabled={signing || pdfLoading}
                >
                  {signing ? (
                    <><span className="sm-btn-spinner" /> Processing…</>
                  ) : "Submit Signature"}
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import "./TemplateBuilder.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const FIELD_DEFAULTS = {
  signature: { w: 0.30, h: 0.09 },
  initials:  { w: 0.11, h: 0.07 },
  date:      { w: 0.20, h: 0.05 },
};

const FIELD_COLORS = {
  signature: { border: "#2563eb", bg: "rgba(37,99,235,0.1)" },
  initials:  { border: "#16a34a", bg: "rgba(22,163,74,0.1)" },
  date:      { border: "#d97706", bg: "rgba(217,119,6,0.1)" },
};

const FIELD_LABELS = { signature: "Signature", initials: "Initials", date: "Date" };
const FIELD_BADGES = { signature: "Sig", initials: "Init", date: "Date" };

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function TemplateBuilder({ pdfFile, user, onSave, onClose }) {
  const [templateName, setTemplateName] = useState("");
  const [pageImages, setPageImages] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [fields, setFields] = useState([]);
  const [activeTool, setActiveTool] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    if (!pdfFile) return;
    let cancelled = false;
    setPdfLoading(true);
    setPageImages([]);

    (async () => {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/cmaps/",
        cMapPacked: true,
      }).promise;

      const images = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.92));
      }

      if (!cancelled) {
        setPageImages(images);
        setPdfLoading(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setError("Failed to render PDF: " + err.message);
        setPdfLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [pdfFile]);

  const getPageEl = useCallback((pageIndex) => {
    return document.querySelector(`.tb-page-wrap[data-page="${pageIndex}"]`);
  }, []);

  const fractionFromEvent = useCallback((e, pageEl) => {
    const rect = pageEl.getBoundingClientRect();
    return {
      fx: (e.clientX - rect.left) / rect.width,
      fy: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  const handlePagePointerDown = useCallback((e, pageIndex) => {
    if (!activeTool) return;
    if (e.target.closest("[data-field]")) return;

    const pageEl = e.currentTarget;
    const rect = pageEl.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;

    const { w, h } = FIELD_DEFAULTS[activeTool];
    const x = Math.min(Math.max(fx - w / 2, 0), 1 - w);
    const y = Math.min(Math.max(fy - h / 2, 0), 1 - h);

    const newField = {
      id: generateId(),
      type: activeTool,
      pageIndex,
      x,
      y,
      w,
      h,
    };

    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setActiveTool(null);
  }, [activeTool]);

  const handleFieldPointerDown = useCallback((e, fieldId, pageIndex) => {
    e.stopPropagation();
    if (e.target.closest("[data-resize-handle]")) return;
    setSelectedId(fieldId);

    const pageEl = getPageEl(pageIndex);
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      fieldId,
      startX: e.clientX,
      startY: e.clientY,
      origX: field.x,
      origY: field.y,
      pageWidth: rect.width,
      pageHeight: rect.height,
    };
  }, [fields, getPageEl]);

  const handleResizePointerDown = useCallback((e, fieldId, pageIndex) => {
    e.stopPropagation();
    const pageEl = getPageEl(pageIndex);
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      fieldId,
      startX: e.clientX,
      startY: e.clientY,
      origW: field.w,
      origH: field.h,
      origX: field.x,
      origY: field.y,
      pageWidth: rect.width,
      pageHeight: rect.height,
    };
  }, [fields, getPageEl]);

  useEffect(() => {
    const onMove = (e) => {
      if (dragRef.current) {
        const { fieldId, startX, startY, origX, origY, pageWidth, pageHeight } = dragRef.current;
        const dx = (e.clientX - startX) / pageWidth;
        const dy = (e.clientY - startY) / pageHeight;
        setFields((prev) =>
          prev.map((f) => {
            if (f.id !== fieldId) return f;
            return {
              ...f,
              x: Math.min(Math.max(origX + dx, 0), 1 - f.w),
              y: Math.min(Math.max(origY + dy, 0), 1 - f.h),
            };
          })
        );
      }
      if (resizeRef.current) {
        const { fieldId, startX, startY, origW, origH, origX, origY, pageWidth, pageHeight } = resizeRef.current;
        const dw = (e.clientX - startX) / pageWidth;
        const dh = (e.clientY - startY) / pageHeight;
        setFields((prev) =>
          prev.map((f) => {
            if (f.id !== fieldId) return f;
            const newW = Math.max(0.05, Math.min(origW + dw, 1 - origX));
            const newH = Math.max(0.03, Math.min(origH + dh, 1 - origY));
            return { ...f, w: newW, h: newH };
          })
        );
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const deleteField = useCallback((id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((sel) => (sel === id ? null : sel));
  }, []);

  const handleSave = async () => {
    if (!templateName.trim()) {
      setError("Please enter a template name.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const safeName = pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `users/${user.uid}/documents/templates/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, pdfFile);
      const pdfUrl = await getDownloadURL(storageRef);

      const templateData = {
        name: templateName.trim(),
        pdfUrl,
        fields,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, "users", user.uid, "signTemplates"), templateData);
      onSave({ id: docRef.id, ...templateData });
    } catch (err) {
      setError("Save failed: " + err.message);
      setSaving(false);
    }
  };

  const toggleTool = (type) => {
    setActiveTool((prev) => (prev === type ? null : type));
  };

  return (
    <div className="tb-overlay" onClick={() => setSelectedId(null)}>
      <div className="tb-header" onClick={(e) => e.stopPropagation()}>
        <input
          className="tb-name-input"
          placeholder="Template name…"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <button className="tb-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="tb-body" onClick={(e) => e.stopPropagation()}>
        <div className="tb-canvas-area">
          {pdfLoading && (
            <div className="tb-loading">Rendering PDF…</div>
          )}
          {!pdfLoading && activeTool && (
            <div className="tb-hint-banner">
              Click anywhere on the page to place a <strong>{FIELD_LABELS[activeTool]}</strong> field
            </div>
          )}
          {pageImages.map((src, pageIndex) => (
            <div
              key={pageIndex}
              className="tb-page-container"
            >
              <div
                className="tb-page-wrap"
                data-page={pageIndex}
                style={{ cursor: activeTool ? "crosshair" : "default" }}
                onPointerDown={(e) => handlePagePointerDown(e, pageIndex)}
              >
                <img
                  src={src}
                  alt={`Page ${pageIndex + 1}`}
                  className="tb-page-img"
                  draggable={false}
                />
                {fields
                  .filter((f) => f.pageIndex === pageIndex)
                  .map((field) => {
                    const colors = FIELD_COLORS[field.type];
                    const isSelected = selectedId === field.id;
                    return (
                      <div
                        key={field.id}
                        data-field={field.id}
                        className={`tb-field${isSelected ? " tb-field--selected" : ""}`}
                        style={{
                          left: `${field.x * 100}%`,
                          top: `${field.y * 100}%`,
                          width: `${field.w * 100}%`,
                          height: `${field.h * 100}%`,
                          borderColor: colors.border,
                          backgroundColor: colors.bg,
                          cursor: activeTool ? "crosshair" : "grab",
                        }}
                        onPointerDown={(e) => handleFieldPointerDown(e, field.id, pageIndex)}
                        onClick={(e) => { e.stopPropagation(); setSelectedId(field.id); }}
                      >
                        <span className="tb-field-label" style={{ color: colors.border }}>
                          {FIELD_LABELS[field.type]}
                        </span>
                        {isSelected && (
                          <button
                            className="tb-field-delete"
                            style={{ borderColor: colors.border, color: colors.border }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                          >
                            ✕
                          </button>
                        )}
                        <div
                          data-resize-handle="true"
                          className="tb-resize-handle"
                          style={{ borderColor: colors.border }}
                          onPointerDown={(e) => handleResizePointerDown(e, field.id, pageIndex)}
                        />
                      </div>
                    );
                  })}
              </div>
              <div className="tb-page-label">Page {pageIndex + 1}</div>
            </div>
          ))}
        </div>

        <div className="tb-sidebar">
          <div className="tb-sidebar-section">
            <div className="tb-sidebar-title">Add Fields</div>
            {["signature", "initials", "date"].map((type) => {
              const colors = FIELD_COLORS[type];
              const isActive = activeTool === type;
              return (
                <button
                  key={type}
                  className={`tb-tool-btn${isActive ? " tb-tool-btn--active" : ""}`}
                  style={isActive
                    ? { backgroundColor: colors.border, borderColor: colors.border, color: "#fff" }
                    : { borderColor: colors.border, color: colors.border }
                  }
                  onClick={() => toggleTool(type)}
                >
                  {FIELD_LABELS[type]}
                </button>
              );
            })}
          </div>

          <div className="tb-sidebar-section tb-sidebar-section--fields">
            <div className="tb-sidebar-title">Placed Fields</div>
            {fields.length === 0 && (
              <div className="tb-no-fields">No fields placed yet.</div>
            )}
            {fields.map((field) => {
              const colors = FIELD_COLORS[field.type];
              const isSelected = selectedId === field.id;
              return (
                <div
                  key={field.id}
                  className={`tb-field-row${isSelected ? " tb-field-row--selected" : ""}`}
                  onClick={() => setSelectedId(field.id)}
                >
                  <span
                    className="tb-field-badge"
                    style={{ backgroundColor: colors.border }}
                  >
                    {FIELD_BADGES[field.type]}
                  </span>
                  <span className="tb-field-row-info">
                    Page {field.pageIndex + 1}
                  </span>
                  <button
                    className="tb-field-row-delete"
                    onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="tb-sidebar-footer">
            {error && <div className="tb-error">{error}</div>}
            <button
              className="tb-save-btn"
              onClick={handleSave}
              disabled={saving || pdfLoading}
            >
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

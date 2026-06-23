import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";

const API = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000';
import {
  doc, getDoc, addDoc, setDoc, getDocs,
  collection, serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "./useAuth";
import "./ContractorWelcome.css";

const AVATAR_COLORS = [
  ["#eff6ff","#2563eb"],["#ecfeff","#0891b2"],["#f0fdf4","#16a34a"],
  ["#fef9c3","#ca8a04"],["#fdf4ff","#9333ea"],["#fff1f2","#e11d48"],["#fff7ed","#ea580c"],
];
const avatarColor = (str = "") => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

const formatPhone = (phone = "") => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
};

const toE164 = (phone) => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return phone.trim();
};

const EMPTY_ORG = { companyName: "", companyAddress: "", companyPhone: "", googleReviewsUrl: "" };

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const FEATURES = [
    { icon: <ChatBubbleIcon />, label: "Company Chat",  desc: "AI-powered answers about your jobs and estimates.", path: "/myclaim/chatbot",      bg: "#eff6ff", color: "#2563eb" },
    { icon: <IntegIcon />,      label: "Integrations",  desc: "Manage CompanyCam and other connected tools.",      path: "/myclaim/integrations", bg: "#f5f3ff", color: "#7c3aed" },
  ];

  const [organizationName, setOrganizationName] = useState("");
  const [userDetails,      setUserDetails]      = useState(null);
  const [companyName,      setCompanyName]      = useState("");
  const [orgInfo,          setOrgInfo]          = useState(EMPTY_ORG);
  const [orgEdit,          setOrgEdit]          = useState(EMPTY_ORG);
  const [editingOrg,       setEditingOrg]       = useState(false);
  const [savingOrg,        setSavingOrg]        = useState(false);
  const [saveOrgError,     setSaveOrgError]     = useState("");
  const [recentClients,    setRecentClients]    = useState([]);
  const [recentLoading,    setRecentLoading]    = useState(true);
  const [showModal,        setShowModal]        = useState(false);
  const [clientName,       setClientName]       = useState("");
  const [clientPhone,      setClientPhone]      = useState("");
  const [saving,           setSaving]           = useState(false);
  const [saved,            setSaved]            = useState(false);
  const [saveError,        setSaveError]        = useState("");

  const clientAddressRef       = useRef(null);
  const clientAutocompleteRef  = useRef(null);
  const companyAddressRef      = useRef(null);
  const companyAutocompleteRef = useRef(null);

  // ── Load everything once user is confirmed ───────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setRecentLoading(true);
    (async () => {
      try {
        setUserDetails({ displayName: user.displayName, email: user.email, photoURL: user.photoURL, uid: user.uid });
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        const oid = userSnap.data()?.organizationId;
        if (!oid) return;
        setOrganizationName(oid);
        const [orgSnap, clientsSnap] = await Promise.all([
          getDoc(doc(db, "organization_data", oid)),
          getDocs(collection(db, "organization_data", oid, "clients")),
        ]);
        if (cancelled) return;
        if (orgSnap.exists()) {
          const d = orgSnap.data();
          const info = { companyName: d.companyName || "", companyAddress: d.companyAddress || "", companyPhone: d.companyPhone || "", googleReviewsUrl: d.googleReviewsUrl || "" };
          setOrgInfo(info); setOrgEdit(info);
          if (info.companyName) setCompanyName(info.companyName);
        }
        const all = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        all.sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));
        setRecentClients(all.slice(0, 6));
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Google Places — client modal ─────────────────────────────────────
  useEffect(() => {
    if (!showModal || !clientAddressRef.current || !window.google?.maps?.places) return;
    clientAutocompleteRef.current = new window.google.maps.places.Autocomplete(
      clientAddressRef.current, { types: ["address"], componentRestrictions: { country: "us" } }
    );
    clientAutocompleteRef.current.addListener("place_changed", () => {
      const place = clientAutocompleteRef.current.getPlace();
      if (place?.formatted_address && clientAddressRef.current) clientAddressRef.current.value = place.formatted_address;
    });
    return () => { if (clientAutocompleteRef.current) window.google.maps.event.clearInstanceListeners(clientAutocompleteRef.current); };
  }, [showModal]);

  // ── Google Places — company address ─────────────────────────────────
  useEffect(() => {
    if (!editingOrg || !companyAddressRef.current || !window.google?.maps?.places) return;
    companyAutocompleteRef.current = new window.google.maps.places.Autocomplete(
      companyAddressRef.current, { types: ["address"], componentRestrictions: { country: "us" } }
    );
    companyAutocompleteRef.current.addListener("place_changed", () => {
      const place = companyAutocompleteRef.current.getPlace();
      if (place?.formatted_address && companyAddressRef.current) companyAddressRef.current.value = place.formatted_address;
    });
    return () => { if (companyAutocompleteRef.current) window.google.maps.event.clearInstanceListeners(companyAutocompleteRef.current); };
  }, [editingOrg]);

  const firstName = userDetails?.displayName?.split(" ")[0] || userDetails?.email?.split("@")[0] || "there";

  const saveOrg = async (e) => {
    e.preventDefault();
    if (!organizationName) return;
    setSavingOrg(true); setSaveOrgError("");
    const address = companyAddressRef.current?.value?.trim() || orgEdit.companyAddress;
    const payload = {
      companyName:      orgEdit.companyName.trim()      || null,
      companyAddress:   address                          || null,
      companyPhone:     orgEdit.companyPhone.trim()     || null,
      googleReviewsUrl: orgEdit.googleReviewsUrl.trim() || null,
    };
    try {
      await setDoc(doc(db, "organization_data", organizationName), payload, { merge: true });
      const saved = { ...orgEdit, companyAddress: address || "" };
      setOrgInfo(saved);
      if (saved.companyName) setCompanyName(saved.companyName);
      setEditingOrg(false);
    } catch (err) {
      console.error("saveOrg error:", err);
      setSaveOrgError(err.message || "Could not save. Please try again.");
    } finally { setSavingOrg(false); }
  };

  const openModal  = () => { setShowModal(true); setSaved(false); setSaveError(""); };
  const closeModal = () => { setShowModal(false); setClientName(""); setClientPhone(""); setSaved(false); setSaveError(""); };

  const handleAddClient = async (e) => {
    e.preventDefault();
    if (!clientPhone || !organizationName) return;
    setSaving(true); setSaveError("");
    const normalizedPhone = toE164(clientPhone);
    const address = clientAddressRef.current?.value?.trim() || null;
    try {
      const existing = await getDoc(doc(db, "client_phones", normalizedPhone));
      if (existing.exists()) { setSaveError("A client with this phone number is already registered."); setSaving(false); return; }
      const clientRef = await addDoc(collection(db, "organization_data", organizationName, "clients"), {
        name: clientName.trim() || null, address, phone: normalizedPhone,
        addedBy: userDetails?.email || null, addedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "client_phones", normalizedPhone), {
        orgId: organizationName, name: clientName.trim() || null, address, registeredAt: serverTimestamp(),
      }, { merge: true });

      // Auto-create Drive folder structure — fire and forget, non-blocking
      fetch(`${API}/integrations/google-drive/create-client-folder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: organizationName,
          phone: normalizedPhone,
          clientName: clientName.trim() || normalizedPhone,
          clientDocId: clientRef.id,
        }),
      }).catch(() => {});

      setSaved(true);
      const snap = await getDocs(collection(db, "organization_data", organizationName, "clients"));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));
      setRecentClients(all.slice(0, 6));
      setTimeout(closeModal, 1400);
    } catch (err) {
      console.error("Add client error:", err);
      setSaveError("Something went wrong. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <div className="cw-root">
      <main className="cw-main">

        {/* Hero */}
        <div className="cw-hero">
          {userDetails?.photoURL ? (
            <img src={userDetails.photoURL} alt={firstName} className="cw-avatar" referrerPolicy="no-referrer" />
          ) : (
            <div className="cw-avatar-fallback">{firstName.charAt(0).toUpperCase()}</div>
          )}
          <div className="cw-hero-text">
            <h1>Welcome back, {firstName}!</h1>
            <p className="cw-subtitle">
              <span>{userDetails?.email}</span>&ensp;&middot;&ensp;{companyName}
            </p>
          </div>
        </div>

        {/* Split row: company info + clients */}
        <div className="cw-split-row">

          {/* Company admin card */}
          <div className="cw-info-card">
            <div className="cw-card-header">
              <div className="cw-card-header-left">
                <BuildingIcon />
                <h2>Company Info</h2>
              </div>
              {!editingOrg && (
                <button className="cw-edit-btn" onClick={() => { setOrgEdit({ ...orgInfo }); setEditingOrg(true); }}>
                  {orgInfo.companyName ? "Edit" : <><PlusIcon /> Set Up</>}
                </button>
              )}
            </div>

            {editingOrg ? (
              <form className="cw-org-form" onSubmit={saveOrg}>
                <input className="cw-field-input" placeholder="Company name" value={orgEdit.companyName}
                  onChange={e => setOrgEdit(o => ({ ...o, companyName: e.target.value }))} />
                <input ref={companyAddressRef} className="cw-field-input" placeholder="Company address"
                  defaultValue={orgEdit.companyAddress} autoComplete="off" />
                <input className="cw-field-input" placeholder="Phone number" value={orgEdit.companyPhone}
                  onChange={e => setOrgEdit(o => ({ ...o, companyPhone: e.target.value }))} />
                <input className="cw-field-input" placeholder="Google Reviews URL" value={orgEdit.googleReviewsUrl}
                  onChange={e => setOrgEdit(o => ({ ...o, googleReviewsUrl: e.target.value }))} />
                {saveOrgError && <p className="cw-modal-error">{saveOrgError}</p>}
                <div className="cw-org-actions">
                  <button type="button" className="cw-btn-secondary" onClick={() => { setEditingOrg(false); setSaveOrgError(""); }}>Cancel</button>
                  <button type="submit" className="cw-btn-primary" disabled={savingOrg}>
                    {savingOrg ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : orgInfo.companyName ? (
              <div className="cw-org-view">
                <p className="cw-org-name">{orgInfo.companyName}</p>
                {orgInfo.companyAddress && (
                  <p className="cw-org-row"><PinIcon /> {orgInfo.companyAddress}</p>
                )}
                {orgInfo.companyPhone && (
                  <p className="cw-org-row"><PhoneIcon /> {formatPhone(orgInfo.companyPhone)}</p>
                )}
                {orgInfo.googleReviewsUrl && (
                  <a href={orgInfo.googleReviewsUrl} target="_blank" rel="noreferrer" className="cw-reviews-link">
                    <StarIcon /> Google Reviews
                  </a>
                )}
              </div>
            ) : (
              <p className="cw-org-empty">No company info set up yet.</p>
            )}
          </div>

          {/* Clients card */}
          <div className="cw-info-card cw-clients-card">
            <div className="cw-card-header">
              <div className="cw-card-header-left">
                <PeopleIcon />
                <h2>Clients</h2>
              </div>
            </div>
            <p className="cw-clients-desc">Add a homeowner so they can track their claim progress and chat with the assistant.</p>
            <div className="cw-clients-btns">
              <button className="cw-add-client-btn" onClick={openModal}>
                <PlusIcon /> Add New Client
              </button>
              <button className="cw-view-all-btn" onClick={() => navigate("/myclaim/clients")}>
                View All <ArrowIcon />
              </button>
            </div>
          </div>

        </div>

        {/* Recent clients */}
        <div className="cw-recent-section">
          <div className="cw-section-label">
            Recent Clients{!recentLoading && recentClients.length > 0 && ` · ${recentClients.length}`}
          </div>
          {recentLoading ? (
            <div className="cw-recent-loading"><div className="cw-spinner" /></div>
          ) : recentClients.length === 0 ? (
            <p className="cw-org-empty" style={{ padding: "8px 0" }}>No clients added yet.</p>
          ) : (
            <div className={`cw-recent-grid cw-recent-grid--${Math.min(recentClients.length, 3)}`}>
              {recentClients.map(client => {
                const label = client.name || client.phone || "?";
                const [bg, fg] = avatarColor(label);
                return (
                  <button
                    key={client.id}
                    className="cw-recent-card"
                    onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(client.phone || client.id)}`)}
                  >
                    <div className="cw-recent-avatar" style={{ background: bg, color: fg }}>
                      {label.charAt(0).toUpperCase()}
                    </div>
                    <div className="cw-recent-info">
                      <p className="cw-recent-name">{client.name || <span className="cw-muted">No name</span>}</p>
                      <p className="cw-recent-phone">{formatPhone(client.phone)}</p>
                    </div>
                    {(client.openContractorTodos > 0) && (
                      <span className="cw-todo-badge">{client.openContractorTodos}</span>
                    )}
                    <ArrowSmIcon />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Feature grid */}
        <div className="cw-section-label">Quick Access</div>
        <div className="cw-features">
          {FEATURES.map(f => (
            <button key={f.path} className="cw-feature-card" onClick={() => navigate(f.path)}
              style={{ "--icon-bg": f.bg, "--accent": f.color }}>
              <div className="cw-feature-icon">{f.icon}</div>
              <div className="cw-feature-body">
                <h3>{f.label}</h3>
                <p>{f.desc}</p>
              </div>
              <ArrowIcon />
            </button>
          ))}
        </div>

      </main>

      {/* Add Client Modal */}
      {showModal && (
        <div className="cw-modal-overlay" onClick={closeModal}>
          <div className="cw-modal" onClick={e => e.stopPropagation()}>
            <div className="cw-modal-header">
              <h3>Add New Client</h3>
              <button className="cw-modal-close" onClick={closeModal}>✕</button>
            </div>
            {saved ? (
              <div className="cw-modal-success"><CheckCircleIcon /><span>Client added successfully!</span></div>
            ) : (
              <form className="cw-modal-form" onSubmit={handleAddClient}>
                {saveError && <p className="cw-modal-error">{saveError}</p>}
                <label className="cw-field-label">Client Name (optional)</label>
                <input className="cw-field-input" type="text" placeholder="Jane Smith"
                  value={clientName} onChange={e => setClientName(e.target.value)} />
                <label className="cw-field-label">Client Address (optional)</label>
                <input ref={clientAddressRef} className="cw-field-input" type="text"
                  placeholder="123 Main St, City, State" autoComplete="off" />
                <label className="cw-field-label">Phone Number <span className="cw-required">*</span></label>
                <input className="cw-field-input" type="tel" placeholder="(555) 123-4567"
                  value={clientPhone} onChange={e => setClientPhone(e.target.value)} required />
                <div className="cw-modal-actions">
                  <button type="button" className="cw-btn-secondary" onClick={closeModal}>Cancel</button>
                  <button type="submit" className="cw-btn-primary" disabled={!clientPhone.trim() || saving}>
                    {saving ? "Saving…" : "Add Client"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
);
const ChatBubbleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
);
const IntegIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>
);
const BuildingIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M3 21h18M3 7v14M21 7v14M3 7h18M9 3h6v4H9z"/>
    <path d="M9 11h2v4H9zm4 0h2v4h-2z"/>
  </svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{ flexShrink: 0 }}>
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{ flexShrink: 0 }}>
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.03 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
  </svg>
);
const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ flexShrink: 0 }}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const ArrowSmIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width="14" height="14" style={{ flexShrink: 0 }}>
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" width="16" height="16">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const CheckCircleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

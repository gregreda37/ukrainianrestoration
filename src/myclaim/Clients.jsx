import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection, getDocs, addDoc, setDoc, getDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, where,
} from "firebase/firestore";
import { useAuth } from "./useAuth";
import "./Clients.css";

const formatDate = (ts) => {
  if (!ts) return null;
  const d = ts.toDate?.() ?? new Date(ts);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const AVATAR_COLORS = [
  ["#eff6ff","#2563eb"],["#ecfeff","#0891b2"],["#f0fdf4","#16a34a"],
  ["#fef9c3","#ca8a04"],["#fdf4ff","#9333ea"],["#fff1f2","#e11d48"],["#fff7ed","#ea580c"],
];
const avatarColor = (str = "") => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};
const toE164 = (phone) => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return phone.trim();
};
const formatPhone = (phone = "") => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
};

export default function Clients() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [organizationName, setOrganizationName] = useState("");
  const [userDetails,      setUserDetails]      = useState(null);
  const [clients,          setClients]          = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState("");
  const [search,           setSearch]           = useState("");
  const [showModal,        setShowModal]        = useState(false);
  const [clientName,       setClientName]       = useState("");
  const [clientPhone,      setClientPhone]      = useState("");
  const [saving,           setSaving]           = useState(false);
  const [saved,            setSaved]            = useState(false);
  const [saveError,        setSaveError]        = useState("");
  const [confirmDelete,    setConfirmDelete]    = useState(null);
  const [deletingClient,   setDeletingClient]   = useState(false);

  const addressInputRef = useRef(null);
  const autocompleteRef = useRef(null);

  // ── Single merged effect — runs once user is confirmed ───────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true); setError("");
    (async () => {
      try {
        const details = { displayName: user.displayName, email: user.email, photoURL: user.photoURL, uid: user.uid };
        setUserDetails(details);

        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        const oid = userSnap.data()?.organizationId;
        if (!oid) { setError("No organization found. Please sign out and back in."); return; }
        setOrganizationName(oid);

        const snap = await getDocs(collection(db, "organization_data", oid, "clients"));
        if (cancelled) return;

        const base = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));

        // Enrich with live user doc data where available
        const enriched = await Promise.all(base.map(async (client) => {
          try {
            // Fast path: uid already cached on client doc
            if (client.uid) {
              const uSnap = await getDoc(doc(db, "users", client.uid));
              if (uSnap.exists()) {
                const u = uSnap.data();
                return { ...client, name: u.displayName || client.name, address: u.address || client.address, lastLogin: u.lastLogin || null, hasAccount: true, nameFromUser: !!u.displayName, addressFromUser: !!u.address };
              }
            }
            // Fallback: look up by phoneNumber field
            if (client.phone) {
              const uSnap = await getDocs(query(collection(db, "users"), where("phoneNumber", "==", client.phone)));
              if (!uSnap.empty) {
                const u = uSnap.docs[0].data();
                return { ...client, name: u.displayName || client.name, address: u.address || client.address, lastLogin: u.lastLogin || null, hasAccount: true, nameFromUser: !!u.displayName, addressFromUser: !!u.address };
              }
            }
          } catch {}
          return { ...client, hasAccount: false };
        }));

        if (!cancelled) setClients(enriched);
      } catch (err) {
        console.error("Clients load error:", err);
        if (!cancelled) setError(err.message || "Could not load clients.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Google Places autocomplete ────────────────────────────────────────
  useEffect(() => {
    if (!showModal || !addressInputRef.current || !window.google?.maps?.places) return;
    autocompleteRef.current = new window.google.maps.places.Autocomplete(
      addressInputRef.current, { types: ["address"], componentRestrictions: { country: "us" } }
    );
    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current.getPlace();
      if (place?.formatted_address && addressInputRef.current) addressInputRef.current.value = place.formatted_address;
    });
    return () => { if (autocompleteRef.current) window.google.maps.event.clearInstanceListeners(autocompleteRef.current); };
  }, [showModal]);

  const openModal  = () => { setShowModal(true); setSaved(false); setSaveError(""); };
  const closeModal = () => { setShowModal(false); setClientName(""); setClientPhone(""); setSaved(false); setSaveError(""); };

  const refreshClients = async (oid) => {
    const snap = await getDocs(collection(db, "organization_data", oid, "clients"));
    const base = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));
    const enriched = await Promise.all(base.map(async (client) => {
      try {
        if (client.uid) {
          const uSnap = await getDoc(doc(db, "users", client.uid));
          if (uSnap.exists()) { const u = uSnap.data(); return { ...client, name: u.displayName || client.name, hasAccount: true, nameFromUser: !!u.displayName }; }
        }
      } catch {}
      return { ...client, hasAccount: false };
    }));
    setClients(enriched);
  };

  const handleAddClient = async (e) => {
    e.preventDefault();
    if (!clientPhone || !organizationName) return;
    setSaving(true); setSaveError("");
    const normalizedPhone = toE164(clientPhone);
    const address = addressInputRef.current?.value?.trim() || null;
    try {
      const existing = await getDoc(doc(db, "client_phones", normalizedPhone));
      if (existing.exists()) { setSaveError("A client with this phone number is already registered."); setSaving(false); return; }
      await addDoc(collection(db, "organization_data", organizationName, "clients"), {
        name: clientName.trim() || null, address, phone: normalizedPhone,
        addedBy: userDetails?.email || null, addedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "client_phones", normalizedPhone), {
        orgId: organizationName, name: clientName.trim() || null, address, registeredAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
      await refreshClients(organizationName);
      setTimeout(closeModal, 1400);
    } catch (err) {
      console.error("Add client error:", err);
      setSaveError("Something went wrong. Please try again.");
    } finally { setSaving(false); }
  };

  const deleteClient = async () => {
    if (!confirmDelete || !organizationName) return;
    setDeletingClient(true);
    const { id, phone } = confirmDelete;
    try {
      if (id) await deleteDoc(doc(db, "organization_data", organizationName, "clients", id));
      if (phone) await deleteDoc(doc(db, "client_phones", phone)).catch(() => {});
      setClients(prev => prev.filter(c => c.id !== id));
      setConfirmDelete(null);
    } finally { setDeletingClient(false); }
  };

  const toggleClaimStatus = async (client, e) => {
    e.stopPropagation();
    const next = (client.claimStatus || "open") === "open" ? "closed" : "open";
    setClients(prev => prev.map(c => c.id === client.id ? { ...c, claimStatus: next } : c));
    try {
      await updateDoc(doc(db, "organization_data", organizationName, "clients", client.id), { claimStatus: next });
    } catch (err) {
      console.error(err);
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, claimStatus: client.claimStatus } : c));
    }
  };

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    return (
      (c.name    || "").toLowerCase().includes(q) ||
      (c.phone   || "").includes(q) ||
      (c.address || "").toLowerCase().includes(q) ||
      (c.claimNumbers || []).some(n => n.toLowerCase().includes(q))
    );
  });

  return (
    <div className="cl-root">
      <div className="cl-main">

        <div className="cl-page-header">
          <div>
            <h1 className="cl-title">Clients</h1>
            <p className="cl-subtitle">
              {loading ? "Loading…" : `${clients.length} client${clients.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button className="cl-add-btn" onClick={openModal}>
            <PlusIcon /> Add New Client
          </button>
        </div>

        <div className="cl-search-wrap">
          <SearchIcon />
          <input className="cl-search" type="text"
            placeholder="Search by name, phone, address, or claim number…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="cl-search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>

        {loading ? (
          <div className="cl-empty"><div className="cl-spinner" /></div>
        ) : error ? (
          <div className="cl-empty"><p style={{ color: "#dc2626" }}>{error}</p></div>
        ) : filtered.length === 0 ? (
          <div className="cl-empty">
            <EmptyIcon />
            <p>{search ? "No clients match your search." : "No clients yet. Add one to get started."}</p>
          </div>
        ) : (() => {
          const openClients   = filtered.filter(c => (c.claimStatus || "open") === "open");
          const closedClients = filtered.filter(c => c.claimStatus === "closed");
          const renderCard = (client) => {
            const label = client.name || client.phone || "Unknown";
            const [bg, fg] = avatarColor(label);
            const isClosed = client.claimStatus === "closed";
            return (
              <div key={client.id} className={`cl-card${client.hasAccount ? " cl-card-active" : ""}${isClosed ? " cl-card--closed" : ""}`}>
                <div className="cl-card-top">
                  <div className="cl-avatar" style={{ background: bg, color: fg }}>
                    {label.charAt(0).toUpperCase()}
                  </div>
                  <div className="cl-card-info">
                    <h3 className={`cl-card-name${client.nameFromUser ? " cl-confirmed" : ""}`}>
                      {client.name || <span className="cl-no-name">No name</span>}
                    </h3>
                    <p className="cl-card-phone">{formatPhone(client.phone)}</p>
                  </div>
                  <div className="cl-card-badges">
                    <span className={`cl-status-toggle cl-status-toggle--${isClosed ? "closed" : "open"}`}>
                      {isClosed ? "Claim Closed" : "Claim Open"}
                    </span>
                    {client.hasAccount && <span className="cl-active-badge"><ActiveDotIcon /> Active</span>}
                    {(client.openContractorTodos > 0) && <span className="cl-todo-badge">{client.openContractorTodos}</span>}
                  </div>
                </div>
                {client.address && (
                  <p className={`cl-card-address${client.addressFromUser ? " cl-confirmed" : ""}`}>
                    <PinIcon /> {client.address}
                  </p>
                )}
                {client.claimNumbers?.length > 0 && (
                  <p className="cl-claim-number"><ClaimIcon /> Claim{client.claimNumbers.length > 1 ? "s" : ""}: {client.claimNumbers.join(", ")}</p>
                )}
                {client.lastLogin && (
                  <p className="cl-last-login"><ClockIcon /> Last login: {formatDate(client.lastLogin)}</p>
                )}
                <div className="cl-card-actions">
                  <button className="cl-open-btn"
                    onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(client.phone || client.id)}`)}>
                    Open Job <ArrowIcon />
                  </button>
                  <button className="cl-delete-btn" onClick={() => setConfirmDelete(client)} title="Delete client">
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          };
          return (
            <>
              {openClients.length > 0 && (
                <div className="cl-grid">{openClients.map(renderCard)}</div>
              )}
              {closedClients.length > 0 && (
                <>
                  <div className="cl-section-label">
                    <span>Closed Claims</span>
                    <span className="cl-section-count">{closedClients.length}</span>
                  </div>
                  <div className="cl-grid">{closedClients.map(renderCard)}</div>
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* Delete Confirm Modal */}
      {confirmDelete && (
        <div className="cl-modal-overlay" onClick={() => !deletingClient && setConfirmDelete(null)}>
          <div className="cl-modal" onClick={e => e.stopPropagation()}>
            <div className="cl-modal-header">
              <h3>Delete Client</h3>
              <button className="cl-modal-close" onClick={() => setConfirmDelete(null)} disabled={deletingClient}>✕</button>
            </div>
            <div className="cl-modal-form">
              <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.6 }}>
                Permanently delete <strong>{confirmDelete.name || confirmDelete.phone}</strong>?
                This cannot be undone.
              </p>
              <div className="cl-modal-actions">
                <button className="cl-btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deletingClient}>Cancel</button>
                <button className="cl-btn-danger" onClick={deleteClient} disabled={deletingClient}>
                  {deletingClient ? "Deleting…" : "Delete Client"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {showModal && (
        <div className="cl-modal-overlay" onClick={closeModal}>
          <div className="cl-modal" onClick={e => e.stopPropagation()}>
            <div className="cl-modal-header">
              <h3>Add New Client</h3>
              <button className="cl-modal-close" onClick={closeModal}>✕</button>
            </div>
            {saved ? (
              <div className="cl-modal-success"><CheckCircleIcon /><span>Client added successfully!</span></div>
            ) : (
              <form className="cl-modal-form" onSubmit={handleAddClient}>
                {saveError && <p className="cl-modal-error">{saveError}</p>}
                <label className="cl-field-label">Client Name (optional)</label>
                <input className="cl-field-input" type="text" placeholder="Jane Smith"
                  value={clientName} onChange={e => setClientName(e.target.value)} />
                <label className="cl-field-label">Client Address (optional)</label>
                <input ref={addressInputRef} className="cl-field-input" type="text"
                  placeholder="123 Main St, City, State" autoComplete="off" />
                <label className="cl-field-label">Phone Number <span className="cl-required">*</span></label>
                <input className="cl-field-input" type="tel" placeholder="(555) 123-4567"
                  value={clientPhone} onChange={e => setClientPhone(e.target.value)} required />
                <div className="cl-modal-actions">
                  <button type="button" className="cl-btn-secondary" onClick={closeModal}>Cancel</button>
                  <button type="submit" className="cl-btn-primary" disabled={!clientPhone.trim() || saving}>
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

const TrashIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>;
const PlusIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const ArrowIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
const PinIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0,marginTop:1}}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const CheckCircleIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const ActiveDotIcon = () => <svg viewBox="0 0 8 8" width="7" height="7" fill="currentColor"><circle cx="4" cy="4" r="4"/></svg>;
const ClaimIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" style={{flexShrink:0}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const ClockIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const EmptyIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;

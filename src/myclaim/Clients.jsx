import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { loadGoogleMaps } from "./loadMaps";
import {
  collection, getDocs, addDoc, setDoc, getDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, query, where,
} from "firebase/firestore";
import { useAuth } from "./useAuth";
import "./Clients.css";

const API = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

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

const CATEGORIES = [
  { key: "dryClean",       label: "Dry Cleaning / Contents" },
  { key: "mitigation",     label: "Mitigation"               },
  { key: "reconstruction", label: "Reconstruction"           },
  { key: "packout",        label: "Packout"                  },
];
const STATUS_META = {
  estimating:    { label: "Estimating",    color: "#64748b", bg: "#f1f5f9" },
  submitted:     { label: "Submitted",     color: "#2563eb", bg: "#eff6ff" },
  negotiating:   { label: "Negotiating",   color: "#d97706", bg: "#fffbeb" },
  supplementing: { label: "Supplementing", color: "#7c3aed", bg: "#f5f3ff" },
  settled:       { label: "Settled ✓",     color: "#15803d", bg: "#dcfce7" },
};
const n = v => parseFloat(v) || 0;
const fmtMoney = v => (parseFloat(v) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function computeTotals(form) {
  let Estimate = 0, Settled = 0, Supplement = 0, Expenses = 0;
  for (const cat of CATEGORIES) {
    Estimate   += n(form[`${cat.key}Estimate`]);
    Settled    += n(form[`${cat.key}Settled`]);
    Supplement += n(form[`${cat.key}Supplement`]);
    Expenses   += n(form[`${cat.key}Expenses`]);
  }
  return { Estimate, Settled, Supplement, Expenses, gap: Math.max(0, Estimate - Settled), recoveryRate: Estimate > 0 ? Settled / Estimate * 100 : 0 };
}
function computeCategoryRecoups(form) {
  const masterPct = n(form.recoupPercent);
  let companyRecoup = 0;
  for (const cat of CATEGORIES) {
    const ov = form[`${cat.key}RecoupPct`];
    const pct = (ov !== null && ov !== undefined && ov !== "") ? n(ov) : masterPct;
    companyRecoup += n(form[`${cat.key}Settled`]) * pct / 100;
  }
  return { companyRecoup };
}
function computePartnerFee(form, companyRecoup) {
  if (!form.partnerId) return 0;
  return form.partnerFeeType === "fixed" ? n(form.partnerFeeValue) : companyRecoup * n(form.partnerFeeValue) / 100;
}

export default function Clients() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [organizationName, setOrganizationName] = useState("");
  const [userDetails,      setUserDetails]      = useState(null);
  const [userRole,         setUserRole]         = useState("admin");
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
  const [confirmDelete,          setConfirmDelete]          = useState(null);
  const [deletingClient,         setDeletingClient]         = useState(false);
  const [archivedClients,        setArchivedClients]        = useState([]);
  const [showArchive,            setShowArchive]            = useState(false);
  const [restoringId,            setRestoringId]            = useState(null);
  const [confirmPermDelete,      setConfirmPermDelete]      = useState(null);
  const [permDeleting,           setPermDeleting]           = useState(false);
  const [permDeleteError,        setPermDeleteError]        = useState("");

  const [expandedId,        setExpandedId]        = useState(null);
  const [settlementData,    setSettlementData]    = useState(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [qeForm,            setQeForm]            = useState({});
  const [qeSaving,          setQeSaving]          = useState(false);

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

        // Read contractor doc fresh to get the latest role and assignedClients
        const contractorSnap = await getDoc(doc(db, "organization_data", oid, "contractors", user.uid));
        if (cancelled) return;
        const contractorRole    = contractorSnap.exists() ? (contractorSnap.data()?.role || "admin") : "admin";
        const needsFilter       = contractorRole === "project_manager" || contractorRole === "public_adjuster";
        const assignedPhones    = needsFilter ? (contractorSnap.data()?.assignedClients || []) : null;
        setUserRole(contractorRole);

        const snap = await getDocs(collection(db, "organization_data", oid, "clients"));
        if (cancelled) return;

        const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Split into active and archived
        const activeDocs   = allDocs
          .filter(c => !c.archived && (assignedPhones === null || assignedPhones.includes(c.phone)))
          .sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));
        const archivedDocs = allDocs
          .filter(c => c.archived)
          .sort((a, b) => (b.archivedAt?.toMillis?.() ?? 0) - (a.archivedAt?.toMillis?.() ?? 0));

        // Enrich active clients with live user data
        const enriched = await Promise.all(activeDocs.map(async (client) => {
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

        if (!cancelled) { setClients(enriched); setArchivedClients(archivedDocs); }
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
    if (!showModal || !addressInputRef.current) return;
    let cancelled = false;
    const attach = () => {
      if (cancelled || !addressInputRef.current || autocompleteRef.current) return;
      autocompleteRef.current = new window.google.maps.places.Autocomplete(
        addressInputRef.current, { types: ["address"], componentRestrictions: { country: "us" } }
      );
      autocompleteRef.current.addListener("place_changed", () => {
        const place = autocompleteRef.current.getPlace();
        if (place?.formatted_address && addressInputRef.current) addressInputRef.current.value = place.formatted_address;
      });
    };
    loadGoogleMaps().then(attach).catch(() => {});
    return () => {
      cancelled = true;
      if (autocompleteRef.current) { window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current); autocompleteRef.current = null; }
    };
  }, [showModal]);

  const openModal  = () => { setShowModal(true); setSaved(false); setSaveError(""); };
  const closeModal = () => { setShowModal(false); setClientName(""); setClientPhone(""); setSaved(false); setSaveError(""); };

  const refreshClients = async (oid) => {
    const contractorSnap = await getDoc(doc(db, "organization_data", oid, "contractors", user.uid)).catch(() => null);
    const contractorRole = contractorSnap?.exists() ? (contractorSnap.data()?.role || "admin") : "admin";
    const needsFilter    = contractorRole === "project_manager" || contractorRole === "public_adjuster";
    const assignedPhones = needsFilter ? (contractorSnap?.data()?.assignedClients || []) : null;

    const snap = await getDocs(collection(db, "organization_data", oid, "clients"));
    const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const activeDocs = allDocs
      .filter(c => !c.archived && (assignedPhones === null || assignedPhones.includes(c.phone)))
      .sort((a, b) => (b.addedAt?.toMillis?.() ?? 0) - (a.addedAt?.toMillis?.() ?? 0));
    const enriched = await Promise.all(activeDocs.map(async (client) => {
      try {
        if (client.uid) {
          const uSnap = await getDoc(doc(db, "users", client.uid));
          if (uSnap.exists()) { const u = uSnap.data(); return { ...client, name: u.displayName || client.name, hasAccount: true, nameFromUser: !!u.displayName }; }
        }
      } catch {}
      return { ...client, hasAccount: false };
    }));
    setClients(enriched);
    setArchivedClients(allDocs.filter(c => c.archived).sort((a, b) => (b.archivedAt?.toMillis?.() ?? 0) - (a.archivedAt?.toMillis?.() ?? 0)));
  };

  const handleAddClient = async (e) => {
    e.preventDefault();
    if (!organizationName) return;
    setSaving(true); setSaveError("");
    const normalizedPhone = clientPhone.trim() ? toE164(clientPhone) : null;
    const address = addressInputRef.current?.value?.trim() || null;
    try {
      if (normalizedPhone) {
        const existing = await getDoc(doc(db, "client_phones", normalizedPhone));
        if (existing.exists()) { setSaveError("A client with this phone number is already registered."); setSaving(false); return; }
      }
      const clientDocRef = await addDoc(collection(db, "organization_data", organizationName, "clients"), {
        name: clientName.trim() || null, address,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        addedBy: userDetails?.email || null, addedAt: serverTimestamp(),
      });
      if (normalizedPhone) {
        await setDoc(doc(db, "client_phones", normalizedPhone), {
          orgId: organizationName, clientDocId: clientDocRef.id,
          name: clientName.trim() || null, address, registeredAt: serverTimestamp(),
        }, { merge: true });
      }
      setSaved(true);
      await refreshClients(organizationName);
      setTimeout(closeModal, 1400);
    } catch (err) {
      console.error("Add client error:", err);
      setSaveError("Something went wrong. Please try again.");
    } finally { setSaving(false); }
  };

  const archiveClient = async () => {
    if (!confirmDelete || !organizationName) return;
    setDeletingClient(true);
    const { id } = confirmDelete;
    try {
      await updateDoc(doc(db, "organization_data", organizationName, "clients", id), {
        archived: true, archivedAt: serverTimestamp(),
      });
      const archived = clients.find(c => c.id === id);
      setClients(prev => prev.filter(c => c.id !== id));
      if (archived) setArchivedClients(prev => [{ ...archived, archived: true }, ...prev]);
      setConfirmDelete(null);
    } finally { setDeletingClient(false); }
  };

  const restoreClient = async (client) => {
    if (!organizationName) return;
    setRestoringId(client.id);
    try {
      await updateDoc(doc(db, "organization_data", organizationName, "clients", client.id), {
        archived: false, archivedAt: null,
      });
      setArchivedClients(prev => prev.filter(c => c.id !== client.id));
      setClients(prev => [{ ...client, archived: false }, ...prev]);
    } finally { setRestoringId(null); }
  };

  const permanentDeleteClient = async () => {
    if (!confirmPermDelete || !organizationName) return;
    setPermDeleting(true);
    setPermDeleteError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API}/clients/permanent-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ orgId: organizationName, clientDocId: confirmPermDelete.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setArchivedClients(prev => prev.filter(c => c.id !== confirmPermDelete.id));
      setConfirmPermDelete(null);
    } catch (err) {
      console.error("Permanent delete error:", err);
      setPermDeleteError(err.message || "Something went wrong. Please try again.");
    } finally {
      setPermDeleting(false);
    }
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

  const loadAndExpandSettlement = async (client) => {
    setExpandedId(client.id);
    setSettlementData(null);
    setQeForm({});
    setSettlementLoading(true);
    try {
      // Fetch both paths without orderBy — avoids silent exclusion of docs missing createdAt
      const [orgSnap, userSnap] = await Promise.all([
        getDocs(collection(db, "organization_data", organizationName, "clients", client.id, "settlements"))
          .catch(e => { console.warn("org settlements:", e); return null; }),
        client.uid
          ? getDocs(collection(db, "users", client.uid, "settlements"))
              .catch(e => { console.warn("user settlements:", e); return null; })
          : Promise.resolve(null),
      ]);

      const orgSets  = orgSnap?.docs.map(d => ({ id: d.id, _isOrgSettlement: true, ...d.data() })) ?? [];
      const userSets = userSnap?.docs.map(d => ({ id: d.id, ...d.data() })) ?? [];
      const seen = new Set(userSets.map(x => x.id));
      const all  = [...userSets, ...orgSets.filter(x => !seen.has(x.id))];

      const ts = v => v?.toMillis?.() ?? 0;
      const s = all.sort((a, b) => ts(b.updatedAt ?? b.createdAt) - ts(a.updatedAt ?? a.createdAt))[0] ?? null;

      setSettlementData(s);
      if (s) {
        setQeForm({
          status:                   s.status                   || "estimating",
          settlementDate:           s.settlementDate           || "",
          dryCleanEstimate:         s.dryCleanEstimate         ?? "",
          mitigationEstimate:       s.mitigationEstimate       ?? "",
          reconstructionEstimate:   s.reconstructionEstimate   ?? "",
          packoutEstimate:          s.packoutEstimate          ?? "",
          dryCleanSupplement:       s.dryCleanSupplement       ?? "",
          mitigationSupplement:     s.mitigationSupplement     ?? "",
          reconstructionSupplement: s.reconstructionSupplement ?? "",
          packoutSupplement:        s.packoutSupplement        ?? "",
          dryCleanSettled:          s.dryCleanSettled          ?? "",
          mitigationSettled:        s.mitigationSettled        ?? "",
          reconstructionSettled:    s.reconstructionSettled    ?? "",
          packoutSettled:           s.packoutSettled           ?? "",
          dryCleanExpenses:         s.dryCleanExpenses         ?? "",
          mitigationExpenses:       s.mitigationExpenses       ?? "",
          reconstructionExpenses:   s.reconstructionExpenses   ?? "",
          packoutExpenses:          s.packoutExpenses          ?? "",
        });
      }
    } catch (err) {
      console.error("Settlement load error:", err);
    } finally {
      setSettlementLoading(false);
    }
  };

  const doQuickSave = async (client) => {
    if (!settlementData || !organizationName) return;
    setQeSaving(true);
    try {
      const s = settlementData;
      const merged = { ...s, ...qeForm };
      const totals = computeTotals(merged);
      const hasSettled = totals.Settled > 0;
      const settlementDate = qeForm.settlementDate ||
        (hasSettled && qeForm.status === "settled" ? new Date().toISOString().slice(0, 10) : s.settlementDate || "");
      const recoups    = computeCategoryRecoups(merged);
      const partnerFee = hasSettled ? computePartnerFee(merged, recoups.companyRecoup) : 0;
      const patch = {
        status:                   qeForm.status,
        settlementDate,
        dryCleanEstimate:         qeForm.dryCleanEstimate,
        mitigationEstimate:       qeForm.mitigationEstimate,
        reconstructionEstimate:   qeForm.reconstructionEstimate,
        packoutEstimate:          qeForm.packoutEstimate,
        dryCleanSupplement:       qeForm.dryCleanSupplement,
        mitigationSupplement:     qeForm.mitigationSupplement,
        reconstructionSupplement: qeForm.reconstructionSupplement,
        packoutSupplement:        qeForm.packoutSupplement,
        dryCleanSettled:          qeForm.dryCleanSettled,
        mitigationSettled:        qeForm.mitigationSettled,
        reconstructionSettled:    qeForm.reconstructionSettled,
        packoutSettled:           qeForm.packoutSettled,
        dryCleanExpenses:         qeForm.dryCleanExpenses,
        mitigationExpenses:       qeForm.mitigationExpenses,
        reconstructionExpenses:   qeForm.reconstructionExpenses,
        packoutExpenses:          qeForm.packoutExpenses,
        totalEstimate:            totals.Estimate,
        totalSettled:             totals.Settled,
        recoveryRate:             hasSettled ? totals.recoveryRate : null,
        gap:                      hasSettled ? totals.gap          : null,
        companyRecoup:            hasSettled ? recoups.companyRecoup : null,
        partnerFee:               hasSettled && merged.partnerId ? partnerFee : null,
        companyNetAfterPartner:   hasSettled ? recoups.companyRecoup - (merged.partnerId ? partnerFee : 0) : null,
        updatedAt:                serverTimestamp(),
      };
      const settRef = s._isOrgSettlement
        ? doc(db, "organization_data", organizationName, "clients", client.id, "settlements", s.id)
        : doc(db, "users", client.uid, "settlements", s.id);
      await updateDoc(settRef, patch);
      updateDoc(doc(db, "organization_data", organizationName, "settlement_summary", s.id), {
        status:                 qeForm.status,
        settlementDate,
        dryCleanEstimate:       n(qeForm.dryCleanEstimate),
        mitigationEstimate:     n(qeForm.mitigationEstimate),
        reconstructionEstimate: n(qeForm.reconstructionEstimate),
        packoutEstimate:        n(qeForm.packoutEstimate),
        dryCleanSettled:        n(qeForm.dryCleanSettled),
        mitigationSettled:      n(qeForm.mitigationSettled),
        reconstructionSettled:  n(qeForm.reconstructionSettled),
        packoutSettled:         n(qeForm.packoutSettled),
        totalEstimate:          totals.Estimate,
        totalSettled:           totals.Settled,
        recoveryRate:           hasSettled ? totals.recoveryRate : null,
        gap:                    hasSettled ? totals.gap          : null,
        companyRecoup:          hasSettled ? recoups.companyRecoup : null,
        partnerFee:             hasSettled && merged.partnerId ? partnerFee : null,
        companyNetAfterPartner: hasSettled ? recoups.companyRecoup - (merged.partnerId ? partnerFee : 0) : null,
        updatedAt:              serverTimestamp(),
      }).catch(e => console.warn("settlement_summary quick update:", e));
      setSettlementData(prev => ({ ...prev, ...patch, settlementDate }));
      setExpandedId(null);
    } catch (err) {
      console.error("Quick save error:", err);
    } finally {
      setQeSaving(false);
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

          const renderRow = (client) => {
            const isClosed   = client.claimStatus === "closed";
            const isExpanded = expandedId === client.id;
            const claimNum   = client.claimNumbers?.[0] || "";

            return (
              <div key={client.id} className={`cl-row${isClosed ? " cl-row--closed" : ""}${isExpanded ? " cl-row--expanded" : ""}`}>
                <div className="cl-row-main">
                  <span className={`cl-account-dot cl-account-dot--${client.hasAccount ? "active" : "pending"}`}
                    title={client.hasAccount ? "Portal active" : "Awaiting first login"} />

                  <div className="cl-row-identity">
                    <span className={`cl-row-name${client.nameFromUser ? " cl-confirmed" : ""}`}>
                      {client.name || <span className="cl-no-name">No name</span>}
                    </span>
                    <div className="cl-row-meta">
                      {client.phone && <span className="cl-row-meta-phone">{formatPhone(client.phone)}</span>}
                      {client.address && (
                        <span className="cl-row-meta-addr"><PinIcon /> {client.address}</span>
                      )}
                    </div>
                  </div>

                  <div className="cl-row-claim">
                    {claimNum && (
                      <span className="cl-row-claim-num"><ClaimIcon /> {claimNum}</span>
                    )}
                  </div>

                  <span className={`cl-status-toggle cl-status-toggle--${isClosed ? "closed" : "open"}`}>
                    {isClosed ? "Closed" : "Open"}
                  </span>

                  {client.lastLogin
                    ? <span className="cl-row-login"><ClockIcon /> {formatDate(client.lastLogin)}</span>
                    : <span className="cl-row-login cl-row-login--never">Never logged in</span>
                  }

                  <div className="cl-row-actions">
                    <button className="cl-delete-btn" onClick={() => setConfirmDelete(client)} title="Archive client">
                      <TrashIcon />
                    </button>
                    <button
                      className={`cl-row-expand-btn${isExpanded ? " cl-row-expand-btn--active" : ""}`}
                      onClick={() => {
                        if (isExpanded) { setExpandedId(null); return; }
                        loadAndExpandSettlement(client);
                      }}
                    >
                      <ChevronIcon up={isExpanded} /> Quick Edit
                    </button>
                    <button className="cl-row-open-btn"
                      onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(client.phone || client.id)}`)}>
                      Open <ArrowIcon />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="cl-qe-panel">
                    {settlementLoading ? (
                      <div className="cl-qe-loading"><div className="cl-spinner" style={{ width:24, height:24, borderWidth:2 }} /></div>
                    ) : !settlementData ? (
                      <div className="cl-qe-no-sett">
                        <span>No settlement tracked yet.</span>
                        <button className="cl-qe-full-btn"
                          onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(client.phone || client.id)}`)}>
                          Open full details to add one →
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="cl-qe-top">
                          <div className="cl-qe-field">
                            <label className="cl-qe-label">Status</label>
                            <select className="cl-qe-input cl-qe-select" value={qeForm.status || "estimating"}
                              onChange={e => setQeForm(p => ({ ...p, status: e.target.value }))}>
                              {Object.entries(STATUS_META).map(([v, m]) => (
                                <option key={v} value={v}>{m.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="cl-qe-field">
                            <label className="cl-qe-label">Settlement Date</label>
                            <input className="cl-qe-input" type="date" value={qeForm.settlementDate || ""}
                              onChange={e => setQeForm(p => ({ ...p, settlementDate: e.target.value }))} />
                          </div>
                          {settlementData.claimNumber && (
                            <div className="cl-qe-field">
                              <label className="cl-qe-label">Claim #</label>
                              <span className="cl-qe-static">{settlementData.claimNumber}</span>
                            </div>
                          )}
                        </div>
                        <div className="cl-qe-table-scroll">
                          <table className="cl-qe-table">
                            <thead>
                              <tr>
                                <th className="cl-qe-th-cat">Category</th>
                                <th className="cl-qe-th-num" style={{ color: "#0f172a" }}>Estimate</th>
                                <th className="cl-qe-th-num" style={{ color: "#16a34a" }}>Settled</th>
                                <th className="cl-qe-th-num" style={{ color: "#0891b2" }}>Supplement</th>
                                <th className="cl-qe-th-num" style={{ color: "#dc2626" }}>Expenses</th>
                              </tr>
                            </thead>
                            <tbody>
                              {CATEGORIES.map(cat => (
                                <tr key={cat.key}>
                                  <td className="cl-qe-td-cat">{cat.label}</td>
                                  {["Estimate", "Settled", "Supplement", "Expenses"].map(col => (
                                    <td key={col} className="cl-qe-td-amt">
                                      <input className="cl-qe-amount-input" type="number" min="0" step="0.01" placeholder="—"
                                        value={qeForm[`${cat.key}${col}`] ?? ""}
                                        onChange={e => setQeForm(p => ({ ...p, [`${cat.key}${col}`]: e.target.value }))} />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              {(() => {
                                const qt = computeTotals({ ...settlementData, ...qeForm });
                                return (
                                  <tr className="cl-qe-tfoot-row">
                                    <td className="cl-qe-td-cat">Total</td>
                                    <td className="cl-qe-td-amt" style={{ color:"#0f172a", fontWeight:700 }}>{qt.Estimate   > 0 ? fmtMoney(qt.Estimate)   : "—"}</td>
                                    <td className="cl-qe-td-amt" style={{ color:"#16a34a", fontWeight:700 }}>{qt.Settled    > 0 ? fmtMoney(qt.Settled)    : "—"}</td>
                                    <td className="cl-qe-td-amt" style={{ color:"#0891b2", fontWeight:700 }}>{qt.Supplement > 0 ? fmtMoney(qt.Supplement) : "—"}</td>
                                    <td className="cl-qe-td-amt" style={{ color:"#dc2626", fontWeight:700 }}>{qt.Expenses   > 0 ? fmtMoney(qt.Expenses)   : "—"}</td>
                                  </tr>
                                );
                              })()}
                            </tfoot>
                          </table>
                        </div>
                        <div className="cl-qe-actions">
                          <button className="cl-btn-secondary" onClick={() => setExpandedId(null)}>Cancel</button>
                          <button className="cl-btn-primary" onClick={() => doQuickSave(client)} disabled={qeSaving}>
                            {qeSaving ? "Saving…" : "Save"}
                          </button>
                          <button className="cl-qe-full-btn"
                            onClick={() => navigate(`/myclaim/clients/${encodeURIComponent(client.phone || client.id)}`)}>
                            Full Details →
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          };

          return (
            <>
              {openClients.length > 0 && (
                <div className="cl-list">{openClients.map(renderRow)}</div>
              )}
              {closedClients.length > 0 && (
                <>
                  <div className="cl-section-label">
                    <span>Closed Claims</span>
                    <span className="cl-section-count">{closedClients.length}</span>
                  </div>
                  <div className="cl-list">{closedClients.map(renderRow)}</div>
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* Archive Confirm Modal */}
      {confirmDelete && (
        <div className="cl-modal-overlay" onClick={() => !deletingClient && setConfirmDelete(null)}>
          <div className="cl-modal" onClick={e => e.stopPropagation()}>
            <div className="cl-modal-header">
              <h3>Archive Client</h3>
              <button className="cl-modal-close" onClick={() => setConfirmDelete(null)} disabled={deletingClient}>✕</button>
            </div>
            <div className="cl-modal-form">
              <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.6 }}>
                Archive <strong>{confirmDelete.name || confirmDelete.phone}</strong>?
                They'll be hidden from the client list. Admins can restore them later.
              </p>
              <div className="cl-modal-actions">
                <button className="cl-btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deletingClient}>Cancel</button>
                <button className="cl-btn-danger" onClick={archiveClient} disabled={deletingClient}>
                  {deletingClient ? "Archiving…" : "Archive Client"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal — admin only */}
      {confirmPermDelete && (
        <div className="cl-modal-overlay" onClick={() => !permDeleting && setConfirmPermDelete(null)}>
          <div className="cl-modal" onClick={e => e.stopPropagation()}>
            <div className="cl-modal-header" style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
              <h3 style={{ color: "#dc2626" }}>Permanently Delete Client</h3>
              <button className="cl-modal-close" onClick={() => setConfirmPermDelete(null)} disabled={permDeleting}>✕</button>
            </div>
            <div className="cl-modal-form">
              <p style={{ margin: "0 0 12px", fontSize: 14, color: "#111827", fontWeight: 600 }}>
                This will permanently erase all data for{" "}
                <strong>{confirmPermDelete.name || confirmPermDelete.phone}</strong>.
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                The following will be deleted and <strong>cannot be recovered</strong>:
              </p>
              <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 13, color: "#6b7280", lineHeight: 1.8 }}>
                <li>Client profile &amp; login account</li>
                <li>All documents, todos, selections &amp; budget items</li>
                <li>Claim progress &amp; activity history</li>
                <li>Phone number lookup record (client_phones)</li>
                <li>SMS opt-in record</li>
                <li>All uploaded files in Firebase Storage</li>
                <li>AI analysis caches</li>
              </ul>
              {permDeleteError && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 6 }}>
                  {permDeleteError}
                </p>
              )}
              <div className="cl-modal-actions">
                <button className="cl-btn-secondary" onClick={() => setConfirmPermDelete(null)} disabled={permDeleting}>
                  Cancel
                </button>
                <button
                  className="cl-btn-danger"
                  onClick={permanentDeleteClient}
                  disabled={permDeleting}
                  style={{ background: "#dc2626" }}
                >
                  {permDeleting ? "Deleting…" : "Delete Permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Archived Clients — admin only */}
      {userRole === "admin" && archivedClients.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <button
            className="cl-section-label"
            style={{ width:"100%", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", textAlign:"left" }}
            onClick={() => setShowArchive(v => !v)}
          >
            <span style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span>Archived</span>
              <span className="cl-section-count">{archivedClients.length}</span>
            </span>
            <span style={{ fontSize:12, color:"#94a3b8" }}>{showArchive ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {showArchive && (
            <div className="cl-list" style={{ marginTop:8, opacity:0.75 }}>
              {archivedClients.map(client => (
                <div key={client.id} className="cl-row" style={{ borderStyle:"dashed" }}>
                  <div className="cl-row-main">
                    <span className="cl-account-dot cl-account-dot--pending" />
                    <div className="cl-row-identity">
                      <span className="cl-row-name">{client.name || <span className="cl-no-name">No name</span>}</span>
                      <div className="cl-row-meta">
                        {client.phone && <span className="cl-row-meta-phone">{formatPhone(client.phone)}</span>}
                        {client.address && <span className="cl-row-meta-addr"><PinIcon /> {client.address}</span>}
                      </div>
                    </div>
                    <div className="cl-row-claim" />
                    <span />
                    <span />
                    <div className="cl-row-actions">
                      <button className="cl-row-open-btn"
                        style={{ background:"#f0fdf4", color:"#16a34a", borderColor:"#bbf7d0" }}
                        onClick={() => restoreClient(client)}
                        disabled={restoringId === client.id}>
                        {restoringId === client.id ? "Restoring…" : "↩ Restore"}
                      </button>
                      <button className="cl-delete-btn"
                        style={{ color:"#dc2626" }}
                        onClick={() => { setConfirmPermDelete(client); setPermDeleteError(""); }}
                        title="Permanently delete all client data">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <label className="cl-field-label">Phone Number (optional)</label>
                <input className="cl-field-input" type="tel" placeholder="(555) 123-4567"
                  value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
                <div className="cl-modal-actions">
                  <button type="button" className="cl-btn-secondary" onClick={closeModal}>Cancel</button>
                  <button type="submit" className="cl-btn-primary" disabled={saving}>
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
const ChevronIcon = ({ up }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="13" height="13"
    style={{ transform: up ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

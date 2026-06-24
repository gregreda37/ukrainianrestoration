import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { db, storage } from "../firebase";
import {
  doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  collection, query, orderBy, serverTimestamp, where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "./useAuth";
import { loadGoogleMaps } from "./loadMaps";
import "./ClientDetail.css";

const API = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

// ── Constants ────────────────────────────────────────────────────────────────
const MITIGATION_STEPS = [
  "Claim Submitted",
  "Mitigation in Progress",
  "Mitigation Completed",
  "Estimate Submitted",
  "Estimate Approved",
];
const CONSTRUCTION_STEPS = [
  "Construction Estimate Received",
  "Construction Estimate Approved",
  "Construction Beginning",
  "Construction Completes",
];
const SELECTION_CATEGORIES = [
  "Roofing","Siding","Windows","Flooring",
  "Cabinets","Countertops","Fixtures","Paint","Other",
];
const PORTAL_SECTION_LABELS = {
  todos: "To-Dos",
  progress: "Claim Progress",
  budget: "Budget",
  photos: "My Photos",
  selections: "Client Selections",
};
const BUDGET_ITEMS = [
  { label: "Carpet",               unit: "sq ft"    },
  { label: "Hardwood Flooring",    unit: "sq ft"    },
  { label: "Laminate Flooring",    unit: "sq ft"    },
  { label: "LVP / LVT Flooring",  unit: "sq ft"    },
  { label: "Tile — Floor",         unit: "sq ft"    },
  { label: "Tile — Shower / Tub", unit: "sq ft"    },
  { label: "Tile — Backsplash",   unit: "sq ft"    },
  { label: "Subfloor",             unit: "sq ft"    },
  { label: "Roofing / Shingles",  unit: "sq ft"    },
  { label: "Siding",               unit: "sq ft"    },
  { label: "Drywall",              unit: "sq ft"    },
  { label: "Insulation",           unit: "sq ft"    },
  { label: "Painting — Walls",    unit: "sq ft"    },
  { label: "Painting — Ceilings", unit: "sq ft"    },
  { label: "Painting — Exterior", unit: "sq ft"    },
  { label: "Countertops",          unit: "sq ft"    },
  { label: "Structural Repairs",  unit: "sq ft"    },
  { label: "Framing",              unit: "sq ft"    },
  { label: "Demo / Removal",      unit: "sq ft"    },
  { label: "Baseboards / Trim",   unit: "lin ft"   },
  { label: "Crown Molding",       unit: "lin ft"   },
  { label: "Windows",             unit: "count"    },
  { label: "Interior Doors",      unit: "count"    },
  { label: "Exterior Doors",      unit: "count"    },
  { label: "Bathroom Vanity",     unit: "count"    },
  { label: "Toilet",              unit: "count"    },
  { label: "Bathtub / Shower",    unit: "count"    },
  { label: "Light Fixtures",      unit: "count"    },
  { label: "Appliances",          unit: "count"    },
  { label: "HVAC Unit",           unit: "count"    },
  { label: "Water Heater",        unit: "count"    },
  { label: "Labor",               unit: "hrs"      },
  { label: "Other",               unit: "lump sum" },
];

const formatDate = (ts) => {
  if (!ts) return "";
  const d = ts.toDate?.() ?? new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const formatPhone = (phone = "") => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
};
const formatBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

const formatDateTime = (ts) => {
  if (!ts) return "";
  const d = ts.toDate?.() ?? new Date(ts);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const ACTIVITY_ICONS = {
  login:               "🔐",
  todo_completed:      "✅",
  todo_uncompleted:    "↩️",
  selection_added:     "🎨",
  selection_approved:  "✓",
  selection_rejected:  "✗",
  document_uploaded:   "📄",
  document_deleted:    "🗑",
  info_updated:        "✏️",
};
const ACTIVITY_COLORS = {
  login:               { bg: "#eff6ff" },
  todo_completed:      { bg: "#f0fdf4" },
  todo_uncompleted:    { bg: "#fefce8" },
  selection_added:     { bg: "#fdf4ff" },
  selection_approved:  { bg: "#f0fdf4" },
  selection_rejected:  { bg: "#fef2f2" },
  document_uploaded:   { bg: "#f0fdf4" },
  document_deleted:    { bg: "#fef2f2" },
  info_updated:        { bg: "#eff6ff" },
};
const ACTIVITY_LABELS = {
  login:               "Client accessed the portal",
  todo_completed:      "Completed a task",
  todo_uncompleted:    "Reopened a task",
  selection_added:     "Added a selection",
  selection_approved:  "Approved a selection",
  selection_rejected:  "Rejected a selection",
  document_uploaded:   "Uploaded a document",
  document_deleted:    "Deleted a document",
  info_updated:        "Updated claim information",
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function ClientDetail() {
  const { id }   = useParams();
  const phone    = decodeURIComponent(id || "");
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  // Org / client identity
  const [orgId,       setOrgId]       = useState(null);
  const [client,      setClient]      = useState(null);
  const [clientDocId, setClientDocId] = useState(null);
  const [clientUid,   setClientUid]   = useState(null);
  const [userDoc,     setUserDoc]     = useState(null);
  const [loading,     setLoading]     = useState(true);

  // Client editable fields
  const [clientFields,       setClientFields]       = useState({ claimNumber: "", policyNumber: "", address: "", email: "" });
  const [clientFieldsEdit,   setClientFieldsEdit]   = useState({ claimNumber: "", policyNumber: "", address: "", email: "" });
  const [editingClientFields,setEditingClientFields]= useState(false);
  const [savingClientFields, setSavingClientFields] = useState(false);
  const [clientFieldsError,  setClientFieldsError]  = useState("");

  // Progress
  const [mitStep,    setMitStep]    = useState(-1);
  const [conStep,    setConStep]    = useState(-1);
  const [savingProg, setSavingProg] = useState(false);

  // Todos
  const [todos,        setTodos]        = useState([]);
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [todoType,     setTodoType]     = useState("upload_file");
  const [todoLabel,    setTodoLabel]    = useState("");
  const [todoAssigned, setTodoAssigned] = useState("client");
  const [addingTodo,   setAddingTodo]   = useState(false);
  const [todoError,    setTodoError]    = useState("");

  // Address autocomplete
  const addressInputRef       = useRef(null);
  const addressAutoRef        = useRef(null);

  // Documents
  const fileInputRef          = useRef(null);
  const contractorFileRef     = useRef(null);
  const [docs,                setDocs]               = useState([]);
  const [uploading,           setUploading]           = useState(false);
  const [contractorUploading, setContractorUploading] = useState(false);
  const [showDocsDrawer,      setShowDocsDrawer]      = useState(false);

  // Google Drive
  const driveExternalRef      = useRef(null);
  const driveInternalRef      = useRef(null);
  const [driveFolderUrl,      setDriveFolderUrl]      = useState('');
  const [driveExternalId,     setDriveExternalId]     = useState('');
  const [driveInternalId,     setDriveInternalId]     = useState('');
  const [driveConnected,      setDriveConnected]      = useState(false);
  const [driveSetupLoading,   setDriveSetupLoading]   = useState(false);
  const [driveUploading,      setDriveUploading]      = useState(false);
  const [driveError,          setDriveError]          = useState('');
  const [driveSyncing,        setDriveSyncing]        = useState(false);
  const [driveSyncMessage,    setDriveSyncMessage]    = useState('');

  // Selections
  const [selections,   setSelections]   = useState([]);
  const [showSelForm,  setShowSelForm]  = useState(false);
  const [selCategory,  setSelCategory]  = useState(SELECTION_CATEGORIES[0]);
  const [selProduct,   setSelProduct]   = useState("");
  const [selUrl,       setSelUrl]       = useState("");
  const [selNotes,     setSelNotes]     = useState("");
  const [savingSel,    setSavingSel]    = useState(false);

  // Budget
  const [budgetItems,     setBudgetItems]     = useState([]);
  const [showBudgetForm,  setShowBudgetForm]  = useState(false);
  const [budgetSearch,    setBudgetSearch]    = useState("");
  const [budgetDropdown,  setBudgetDropdown]  = useState(false);
  const [budgetPrice,     setBudgetPrice]     = useState("");
  const [budgetPriceType, setBudgetPriceType] = useState("flat");
  const [budgetQty,       setBudgetQty]       = useState("1");
  const [budgetDesc,      setBudgetDesc]      = useState("");
  const [addingBudget,    setAddingBudget]    = useState(false);
  const [selectedBudgetItem, setSelectedBudgetItem] = useState(null);

  // Adjuster
  const [adjuster,        setAdjuster]        = useState({ name:"", company:"", phone:"", email:"", notes:"" });
  const [adjusterEdit,    setAdjusterEdit]    = useState({ name:"", company:"", phone:"", email:"", notes:"" });
  const [editingAdjuster, setEditingAdjuster] = useState(false);
  const [savingAdjuster,  setSavingAdjuster]  = useState(false);

  // Portal sections
  const [portalSections, setPortalSections] = useState(
    Object.fromEntries(Object.keys(PORTAL_SECTION_LABELS).map(k => [k, true]))
  );
  const [savingPortal, setSavingPortal] = useState(false);

  // Claims
  const [claimNumber,    setClaimNumber]    = useState("");
  const [editingClaim,   setEditingClaim]   = useState(false);
  const [editClaimValue, setEditClaimValue] = useState("");
  const [savingClaim,    setSavingClaim]    = useState(false);

  // CompanyCam
  const [ccProjectId,      setCcProjectId]      = useState("");
  const [ccProjectName,    setCcProjectName]     = useState("");
  const [ccProjects,       setCcProjects]        = useState([]);
  const [ccProjLoad,       setCcProjLoad]        = useState(false);
  const [showCCPicker,     setShowCCPicker]      = useState(false);
  const [ccSearch,         setCcSearch]          = useState("");
  const [ccPhotos,         setCcPhotos]          = useState([]);
  const [ccPhotoLoad,      setCcPhotoLoad]       = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds]  = useState(null);
  const [showPhotoGrid,    setShowPhotoGrid]     = useState(false);
  const [ccCreating,       setCcCreating]        = useState(false);
  const [classifying,      setClassifying]       = useState(false);
  const [classifyResults,  setClassifyResults]   = useState(null);
  const [classifyError,    setClassifyError]     = useState("");
  const [ccError,          setCcError]           = useState("");

  // Activity log
  const [activityLog, setActivityLog] = useState([]);

  // Tabs
  const [activeTab, setActiveTab] = useState("overview");

  // Notify
  const [notifyOpen,    setNotifyOpen]    = useState(false);
  const [notifySent,    setNotifySent]    = useState(false);
  const [notifyError,   setNotifyError]   = useState("");
  const [notifySending, setNotifySending] = useState(false);
  const notifyRef = useRef(null);

  // Confirm delete client
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const [deletingClient, setDeletingClient] = useState(false);

  // ── Load contractor's org id ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid))
      .then(snap => { if (snap.exists()) setOrgId(snap.data().organizationId || null); })
      .catch(err => console.error("ClientDetail orgId error:", err));
  }, [user]);

  // ── Load client data when orgId resolves ─────────────────────────────
  useEffect(() => {
    if (!orgId || !phone) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // 1. Find client in org clients collection by phone
        const clientsSnap = await getDocs(
          query(collection(db, "organization_data", orgId, "clients"), where("phone", "==", phone))
        );
        if (cancelled) return;
        if (clientsSnap.empty) { setLoading(false); return; }

        const clientDocSnap = clientsSnap.docs[0];
        const clientData = { id: clientDocSnap.id, ...clientDocSnap.data() };
        setClient(clientData);
        setClientDocId(clientDocSnap.id);
        if (clientData.claimNumbers?.[0]) setClaimNumber(clientData.claimNumbers[0]);

        // 2. Resolve client's Firebase Auth uid
        let uid = clientData.uid || null;
        if (!uid && clientData.phone) {
          const usersSnap = await getDocs(
            query(collection(db, "users"), where("phoneNumber", "==", clientData.phone))
          );
          if (!usersSnap.empty) {
            uid = usersSnap.docs[0].id;
            // Cache uid on client doc for future fast lookups
            await setDoc(
              doc(db, "organization_data", orgId, "clients", clientDocSnap.id),
              { uid }, { merge: true }
            );
          }
        }
        if (cancelled) return;

        if (uid) {
          setClientUid(uid);
          const [uDoc, todosSnap, docsSnap, selSnap, budgetSnap, activitySnap] = await Promise.all([
            getDoc(doc(db, "users", uid)),
            getDocs(query(collection(db, "users", uid, "todos"),     orderBy("createdAt", "asc"))).catch(() => null),
            getDocs(query(collection(db, "users", uid, "documents"), orderBy("uploadedAt", "desc"))).catch(() => null),
            getDocs(query(collection(db, "users", uid, "selections"),orderBy("addedAt", "asc"))).catch(() => null),
            getDocs(query(collection(db, "users", uid, "budget"),    orderBy("addedAt", "asc"))).catch(() => null),
            getDocs(query(collection(db, "users", uid, "activity"),  orderBy("timestamp", "desc"))).catch(() => null),
          ]);
          if (cancelled) return;

          if (uDoc.exists()) {
            const u = uDoc.data();
            setUserDoc({ uid, ...u });
            setMitStep(u.mitigationStep ?? -1);
            setConStep(u.constructionStep ?? -1);
            setPortalSections(s => ({ ...s, ...(u.portalSections || {}) }));
            if (u.adjuster) { setAdjuster(u.adjuster); setAdjusterEdit(u.adjuster); }
            if (u.companyCamProjectId) {
              const projId = u.companyCamProjectId;
              setCcProjectId(projId);
              setCcProjectName(u.companyCamProjectName || "");
              if (u.selectedPhotoIds) setSelectedPhotoIds(new Set(u.selectedPhotoIds));
              setCcPhotoLoad(true);
              fetch(`${API}/photos/companycam`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: projId, orgId }),
              })
                .then(r => r.json())
                .then(d => { if (!cancelled) setCcPhotos(Array.isArray(d.photos) ? d.photos : []); })
                .catch(() => {})
                .finally(() => { if (!cancelled) setCcPhotoLoad(false); });
            }
            if (u.claimNumbers?.[0]) setClaimNumber(u.claimNumbers[0]);
            const fields = {
              claimNumber:  u.claimNumbers?.[0] || u.claimNumber || "",
              policyNumber: u.policyNumber || "",
              address:      u.address || clientData.address || "",
              email:        u.email || "",
            };
            setClientFields(fields);
            setClientFieldsEdit(fields);
          }
          if (todosSnap)    setTodos(todosSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          if (docsSnap)     setDocs(docsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          if (selSnap)      setSelections(selSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          if (budgetSnap)   setBudgetItems(budgetSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          if (activitySnap) setActivityLog(activitySnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }

        // Load Drive folder data from the org client doc (stored by create-client-folder)
        const cd = clientData;
        if (cd.driveFolderUrl)      setDriveFolderUrl(cd.driveFolderUrl);
        if (cd.driveExternalFolderId) setDriveExternalId(cd.driveExternalFolderId);
        if (cd.driveInternalFolderId) setDriveInternalId(cd.driveInternalFolderId);

        // Check if Drive is connected for this org
        fetch(`${API}/integrations/google-drive/status?orgId=${encodeURIComponent(orgId)}`)
          .then(r => r.json())
          .then(d => { if (!cancelled) setDriveConnected(!!d.connected); })
          .catch(() => {});
      } catch (err) {
        console.error("ClientDetail load error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, phone]);

  // Close notify dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifyRef.current && !notifyRef.current.contains(e.target)) setNotifyOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Google Places autocomplete — address field ────────────────────────
  useEffect(() => {
    if (!editingClientFields || !addressInputRef.current) return;

    const attach = () => {
      if (!addressInputRef.current || !window.google?.maps?.places) return;
      if (addressAutoRef.current) return; // already attached
      addressAutoRef.current = new window.google.maps.places.Autocomplete(
        addressInputRef.current, { types: ["address"], componentRestrictions: { country: "us" } }
      );
      addressAutoRef.current.addListener("place_changed", () => {
        const place = addressAutoRef.current.getPlace();
        if (place?.formatted_address && addressInputRef.current) {
          addressInputRef.current.value = place.formatted_address;
        }
      });
    };

    let cancelled = false;
    loadGoogleMaps().then(() => { if (!cancelled) attach(); }).catch(() => {});
    return () => {
      cancelled = true;
      if (addressAutoRef.current) { window.google?.maps?.event?.clearInstanceListeners(addressAutoRef.current); addressAutoRef.current = null; }
    };
  }, [editingClientFields]);

  // ── Progress ─────────────────────────────────────────────────────────
  const advanceStep = async (type) => {
    if (!clientUid || savingProg) return;
    setSavingProg(true);
    try {
      if (type === "mit") {
        const next = Math.min(mitStep + 1, MITIGATION_STEPS.length - 1);
        await updateDoc(doc(db, "users", clientUid), { mitigationStep: next, updatedAt: serverTimestamp() });
        setMitStep(next);
      } else {
        const next = Math.min(conStep + 1, CONSTRUCTION_STEPS.length - 1);
        await updateDoc(doc(db, "users", clientUid), { constructionStep: next, updatedAt: serverTimestamp() });
        setConStep(next);
      }
    } catch (err) { console.error("advanceStep error:", err); }
    finally { setSavingProg(false); }
  };

  const regressStep = async (type) => {
    if (!clientUid || savingProg) return;
    setSavingProg(true);
    try {
      if (type === "mit") {
        const next = Math.max(mitStep - 1, -1);
        await updateDoc(doc(db, "users", clientUid), { mitigationStep: next, updatedAt: serverTimestamp() });
        setMitStep(next);
      } else {
        const next = Math.max(conStep - 1, -1);
        await updateDoc(doc(db, "users", clientUid), { constructionStep: next, updatedAt: serverTimestamp() });
        setConStep(next);
      }
    } catch (err) { console.error("regressStep error:", err); }
    finally { setSavingProg(false); }
  };

  // ── Todos ─────────────────────────────────────────────────────────────
  const addTodo = async (e) => {
    e.preventDefault();
    if (!clientUid || !todoLabel.trim()) { setTodoError("Please enter a task label."); return; }
    setAddingTodo(true); setTodoError("");
    try {
      const payload = {
        label: todoLabel.trim(), type: todoType,
        assignedTo: todoAssigned, completed: false,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "users", clientUid, "todos"), payload);
      setTodos(prev => [...prev, { id: docRef.id, ...payload }]);
      setTodoLabel(""); setTodoType("upload_file"); setTodoAssigned("client"); setShowTodoForm(false);
    } catch (err) { console.error("addTodo error:", err); setTodoError(err.message || "Could not add todo."); }
    finally { setAddingTodo(false); }
  };

  const toggleTodo = async (todo) => {
    if (!clientUid) return;
    const upd = { completed: !todo.completed };
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, ...upd } : t));
    await updateDoc(doc(db, "users", clientUid, "todos", todo.id), upd).catch(console.error);
  };

  const deleteTodo = async (id) => {
    if (!clientUid) return;
    setTodos(prev => prev.filter(t => t.id !== id));
    await deleteDoc(doc(db, "users", clientUid, "todos", id)).catch(console.error);
  };

  // ── Google Drive helpers ───────────────────────────────────────────────
  const setupDriveFolder = async () => {
    if (!orgId || !phone) return;
    setDriveSetupLoading(true); setDriveError('');
    try {
      const r = await fetch(`${API}/integrations/google-drive/create-client-folder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          phone,
          clientName: client?.name || phone,
          clientDocId: clientDocId || '',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Setup failed');
      setDriveFolderUrl(d.folderUrl || '');
      setDriveExternalId(d.externalFolderId || '');
      setDriveInternalId(d.internalFolderId || '');
    } catch (err) {
      setDriveError(err.message || 'Could not create Drive folder.');
    } finally {
      setDriveSetupLoading(false);
    }
  };

  const syncFromDrive = async () => {
    if (!orgId || !phone || !driveConnected || !driveFolderUrl || !clientUid) return;
    setDriveSyncing(true); setDriveSyncMessage('');
    try {
      const r = await fetch(`${API}/integrations/google-drive/list-client-files`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, phone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Sync failed');

      const { externalFiles = [], internalFiles = [] } = data;
      const existingDriveIds = new Set(docs.map(d => d.driveFileId).filter(Boolean));
      const existingNames    = new Set(docs.map(d => d.name));

      const toImport = [
        ...externalFiles
          .filter(f => !existingDriveIds.has(f.driveFileId) && !existingNames.has(f.name))
          .map(f => ({ ...f, folder: 'client' })),
        ...internalFiles
          .filter(f => !existingDriveIds.has(f.driveFileId) && !existingNames.has(f.name))
          .map(f => ({ ...f, folder: 'internal' })),
      ];

      if (toImport.length === 0) {
        setDriveSyncMessage('Already in sync — no new files found.');
        return;
      }

      const newDocs = [];
      for (const f of toImport) {
        const payload = {
          name: f.name,
          downloadURL: f.driveFileUrl,
          driveFileId: f.driveFileId,
          size: f.size || 0,
          folder: f.folder,
          uploadedAt: serverTimestamp(),
          uploadedBy: 'drive-sync',
          source: 'google_drive',
        };
        const docRef = await addDoc(collection(db, 'users', clientUid, 'documents'), payload);
        newDocs.push({ id: docRef.id, ...payload });
      }

      setDocs(prev => [...newDocs, ...prev]);
      setDriveSyncMessage(`Synced ${toImport.length} file${toImport.length !== 1 ? 's' : ''} from Drive.`);
    } catch (err) {
      setDriveSyncMessage(err.message || 'Sync failed.');
    } finally {
      setDriveSyncing(false);
    }
  };

  // ── Documents ─────────────────────────────────────────────────────────
  const uploadDoc = async (file, folder = "client") => {
    if (!clientUid || !file) return;
    if (folder === "client") setUploading(true); else setContractorUploading(true);
    try {
      const storageRef = ref(storage, `users/${clientUid}/documents/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      const payload = {
        name: file.name, storagePath: storageRef.fullPath, downloadURL,
        size: file.size, folder, uploadedAt: serverTimestamp(),
        uploadedBy: user?.email || "contractor",
      };
      const docRef = await addDoc(collection(db, "users", clientUid, "documents"), payload);
      setDocs(prev => [{ id: docRef.id, ...payload }, ...prev]);

      // Mirror to Drive using the already-saved Firebase Storage URL
      if (driveConnected) {
        try {
          const dr = await fetch(`${API}/integrations/google-drive/upload`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId,
              fileUrl: downloadURL,
              fileName: file.name,
              clientName: client?.name || phone,
              clientPhone: phone,
              visibleToClient: folder !== 'internal',
            }),
          });
          if (dr.ok) {
            const driveData = await dr.json();
            if (driveData.driveFileId) {
              await updateDoc(doc(db, 'users', clientUid, 'documents', docRef.id), {
                driveFileId: driveData.driveFileId,
                driveFileUrl: driveData.driveFileUrl,
              });
              setDocs(prev => prev.map(d =>
                d.id === docRef.id
                  ? { ...d, driveFileId: driveData.driveFileId, driveFileUrl: driveData.driveFileUrl }
                  : d
              ));
            }
          }
        } catch (err) {
          console.warn('[Drive] Mirror failed:', err.message);
        }
      }
    } catch (err) { console.error("uploadDoc error:", err); alert("Upload failed: " + err.message); }
    finally { setUploading(false); setContractorUploading(false); }
  };

  const deleteDocument = async (document) => {
    if (!clientUid) return;
    setDocs(prev => prev.filter(d => d.id !== document.id));
    await deleteDoc(doc(db, "users", clientUid, "documents", document.id)).catch(console.error);
  };

  // ── Selections ────────────────────────────────────────────────────────
  const addSelection = async (e) => {
    e.preventDefault();
    if (!clientUid || !selProduct.trim()) return;
    setSavingSel(true);
    try {
      const payload = {
        category: selCategory, product: selProduct.trim(),
        url: selUrl.trim() || null, notes: selNotes.trim() || null,
        status: "needs_approval", addedAt: serverTimestamp(), addedBy: "contractor",
      };
      const docRef = await addDoc(collection(db, "users", clientUid, "selections"), payload);
      setSelections(prev => [...prev, { id: docRef.id, ...payload }]);
      setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelCategory(SELECTION_CATEGORIES[0]); setShowSelForm(false);
    } catch (err) { console.error("addSelection error:", err); }
    finally { setSavingSel(false); }
  };

  const updateSelStatus = async (id, status) => {
    if (!clientUid) return;
    setSelections(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    await updateDoc(doc(db, "users", clientUid, "selections", id), { status }).catch(console.error);
  };

  const deleteSel = async (id) => {
    if (!clientUid) return;
    setSelections(prev => prev.filter(s => s.id !== id));
    await deleteDoc(doc(db, "users", clientUid, "selections", id)).catch(console.error);
  };

  // ── Budget ────────────────────────────────────────────────────────────
  const addBudgetItem = async (e) => {
    e.preventDefault();
    if (!clientUid || !selectedBudgetItem || !budgetPrice) return;
    setAddingBudget(true);
    try {
      const price = parseFloat(budgetPrice) || 0;
      const qty   = parseFloat(budgetQty)   || 1;
      const total = budgetPriceType === "per_unit" ? price * qty : price;
      const payload = {
        label: selectedBudgetItem.label, unit: selectedBudgetItem.unit,
        price, priceType: budgetPriceType, qty, total,
        description: budgetDesc.trim() || null, addedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "users", clientUid, "budget"), payload);
      setBudgetItems(prev => [...prev, { id: docRef.id, ...payload }]);
      setBudgetSearch(""); setSelectedBudgetItem(null); setBudgetPrice(""); setBudgetQty("1");
      setBudgetDesc(""); setShowBudgetForm(false);
    } catch (err) { console.error("addBudgetItem error:", err); }
    finally { setAddingBudget(false); }
  };

  const deleteBudgetItem = async (id) => {
    if (!clientUid) return;
    setBudgetItems(prev => prev.filter(b => b.id !== id));
    await deleteDoc(doc(db, "users", clientUid, "budget", id)).catch(console.error);
  };

  const budgetTotal = budgetItems.reduce((s, b) => s + (b.total || 0), 0);

  // ── Adjuster ──────────────────────────────────────────────────────────
  const saveAdjuster = async (e) => {
    e.preventDefault();
    if (!clientUid) return;
    setSavingAdjuster(true);
    try {
      await updateDoc(doc(db, "users", clientUid), { adjuster: adjusterEdit, updatedAt: serverTimestamp() });
      setAdjuster({ ...adjusterEdit });
      setEditingAdjuster(false);
    } catch (err) { console.error("saveAdjuster error:", err); }
    finally { setSavingAdjuster(false); }
  };

  // ── Portal sections ───────────────────────────────────────────────────
  const toggleSection = async (key) => {
    if (!clientUid) return;
    const updated = { ...portalSections, [key]: !portalSections[key] };
    setPortalSections(updated);
    setSavingPortal(true);
    await updateDoc(doc(db, "users", clientUid), { portalSections: updated }).catch(console.error);
    setSavingPortal(false);
  };

  // ── Claim number ──────────────────────────────────────────────────────
  const saveClaimNumber = async (e) => {
    e.preventDefault();
    if (!clientUid || !clientDocId) return;
    setSavingClaim(true);
    try {
      const nums = editClaimValue.trim() ? [editClaimValue.trim()] : [];
      await Promise.all([
        updateDoc(doc(db, "users", clientUid), { claimNumbers: nums, updatedAt: serverTimestamp() }),
        setDoc(doc(db, "organization_data", orgId, "clients", clientDocId), { claimNumbers: nums }, { merge: true }),
      ]);
      setClaimNumber(editClaimValue.trim());
      setEditingClaim(false);
    } catch (err) { console.error("saveClaimNumber error:", err); }
    finally { setSavingClaim(false); }
  };

  // ── Client fields (contractor editable) ──────────────────────────────
  const saveClientFields = async (e) => {
    e.preventDefault();
    if (!clientUid) return;
    setSavingClientFields(true); setClientFieldsError("");
    try {
      const addressVal = (addressInputRef.current?.value ?? clientFieldsEdit.address).trim();
      const payload = {
        policyNumber: clientFieldsEdit.policyNumber.trim() || null,
        address:      addressVal || null,
        email:        clientFieldsEdit.email.trim()        || null,
        claimNumbers: clientFieldsEdit.claimNumber.trim()  ? [clientFieldsEdit.claimNumber.trim()] : [],
        updatedAt:    serverTimestamp(),
      };
      await updateDoc(doc(db, "users", clientUid), payload);
      if (clientDocId) {
        await setDoc(
          doc(db, "organization_data", orgId, "clients", clientDocId),
          { claimNumbers: payload.claimNumbers, address: payload.address },
          { merge: true }
        );
      }
      const saved = {
        claimNumber:  clientFieldsEdit.claimNumber.trim(),
        policyNumber: clientFieldsEdit.policyNumber.trim(),
        address:      addressVal,
        email:        clientFieldsEdit.email.trim(),
      };
      setClientFields(saved);
      setClaimNumber(saved.claimNumber);
      setEditingClientFields(false);
    } catch (err) {
      console.error("saveClientFields error:", err);
      setClientFieldsError(err.message || "Could not save.");
    } finally { setSavingClientFields(false); }
  };

  // ── CompanyCam ────────────────────────────────────────────────────────
  const getThumb = (photo) => {
    const pick = (type) => photo.uris?.find(u => u.type === type);
    const entry = pick("thumb") || pick("medium") || pick("small") || photo.uris?.[0];
    return entry?.uri || entry?.url;
  };

  const isCCPhotoShared = (id) => selectedPhotoIds != null ? selectedPhotoIds.has(id) : true;
  const ccSharedCount = ccPhotos.filter(p => isCCPhotoShared(p.id)).length;

  const fetchCcPhotos = async (projectId) => {
    if (!projectId || !orgId) return;
    setCcPhotoLoad(true);
    try {
      const res = await fetch(`${API}/photos/companycam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, orgId }),
      });
      const data = await res.json();
      setCcPhotos(Array.isArray(data.photos) ? data.photos : []);
    } catch {
      setCcPhotos([]);
    } finally {
      setCcPhotoLoad(false);
    }
  };

  const openCCPicker = async () => {
    setShowCCPicker(true);
    setCcProjLoad(true);
    setCcError("");
    try {
      const res = await fetch(`${API}/companycam/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load projects");
      setCcProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setCcError(err.message || "Could not load projects. Check your CompanyCam API key in Integrations.");
      setCcProjects([]);
    } finally {
      setCcProjLoad(false);
    }
  };

  const linkCCProject = async (project) => {
    if (!clientUid) return;
    setShowCCPicker(false);
    setCcSearch("");
    setCcProjectId(project.id);
    setCcProjectName(project.name);
    setSelectedPhotoIds(null);
    setCcPhotos([]);
    setClassifyResults(null);
    const payload = { companyCamProjectId: project.id, companyCamProjectName: project.name };
    await setDoc(doc(db, "users", clientUid), payload, { merge: true }).catch(console.error);
    fetchCcPhotos(project.id);
  };

  const unlinkCcProject = async () => {
    if (!clientUid) return;
    setCcProjectId(""); setCcProjectName(""); setCcPhotos([]); setSelectedPhotoIds(null);
    setClassifyResults(null); setClassifyError("");
    await setDoc(doc(db, "users", clientUid),
      { companyCamProjectId: null, companyCamProjectName: null, selectedPhotoIds: null },
      { merge: true }
    ).catch(console.error);
  };

  const handleCreateCCProject = async () => {
    const addr = clientFields.address || client?.address;
    if (!addr) { setCcError("Add a client address first."); return; }
    setCcCreating(true); setCcError("");
    try {
      const res = await fetch(`${API}/companycam/projects/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, address: addr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      await linkCCProject(data.project);
    } catch (err) {
      setCcError(err.message || "Could not create project. Check your CompanyCam API key.");
    } finally {
      setCcCreating(false);
    }
  };

  const togglePhotoSelection = async (photoId) => {
    if (!clientUid) return;
    const base = selectedPhotoIds ?? new Set(ccPhotos.map(p => p.id));
    const next = new Set(base);
    if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
    setSelectedPhotoIds(next);
    await setDoc(doc(db, "users", clientUid), { selectedPhotoIds: [...next] }, { merge: true });
  };

  const shareAllPhotos = async () => {
    if (!clientUid || ccPhotos.length === 0) return;
    const all = new Set(ccPhotos.map(p => p.id));
    setSelectedPhotoIds(all);
    await setDoc(doc(db, "users", clientUid), { selectedPhotoIds: [...all] }, { merge: true });
  };

  const clearAllPhotos = async () => {
    if (!clientUid) return;
    setSelectedPhotoIds(new Set());
    await setDoc(doc(db, "users", clientUid), { selectedPhotoIds: [] }, { merge: true });
  };

  const handleClassify = async () => {
    if (!ccProjectId || !orgId) return;
    setClassifying(true); setClassifyError(""); setClassifyResults(null);
    try {
      const res = await fetch(`${API}/companycam/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: ccProjectId, orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Classification failed");
      setClassifyResults(data.results || []);
    } catch (err) {
      setClassifyError(err.message || "Classification failed. Make sure the backend is running.");
    } finally {
      setClassifying(false);
    }
  };

  // ── Notify client ─────────────────────────────────────────────────────
  const sendNotification = async (type) => {
    setNotifyOpen(false); setNotifySending(true); setNotifyError("");
    try {
      const res = await fetch(`${API}/notify-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, type }),
      });
      if (!res.ok) throw new Error("Server error");
      setNotifySent(true);
      setTimeout(() => setNotifySent(false), 3000);
    } catch (err) {
      setNotifyError("Could not send notification. Is the server running?");
    } finally { setNotifySending(false); }
  };

  // ── Delete client ─────────────────────────────────────────────────────
  const doDeleteClient = async () => {
    if (!clientDocId) return;
    setDeletingClient(true);
    try {
      await deleteDoc(doc(db, "organization_data", orgId, "clients", clientDocId));
      await deleteDoc(doc(db, "client_phones", phone)).catch(() => {});
      navigate("/myclaim/clients");
    } finally { setDeletingClient(false); }
  };

  // ── Render guards ─────────────────────────────────────────────────────
  if (loading) return <div className="cd-loading"><div className="cd-spinner" /></div>;
  if (!client) return (
    <div className="cd-loading">
      <p style={{ color: "#64748b", textAlign:"center" }}>
        Client not found.{" "}
        <button className="cd-back-btn" onClick={() => navigate("/myclaim/clients")}>← Back to Clients</button>
      </p>
    </div>
  );

  const label    = client.name || phone;
  const initials = label.charAt(0).toUpperCase();
  const hasPortal = !!clientUid;

  const selByCategory = SELECTION_CATEGORIES.reduce((acc, cat) => {
    const items = selections.filter(s => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  const clientTodos     = todos.filter(t => t.assignedTo !== "contractor");
  const contractorTodos = todos.filter(t => t.assignedTo === "contractor");

  const filteredBudgetItems = BUDGET_ITEMS.filter(item =>
    item.label.toLowerCase().includes(budgetSearch.toLowerCase())
  );

  return (
    <div className="cd-root">
      <div className="cd-main">

        {/* ── Back ──────────────────────────────────────────────────── */}
        <button className="cd-back-btn" onClick={() => navigate("/myclaim/clients")}>
          <BackIcon /> Back to Clients
        </button>

        {/* ── Header card ────────────────────────────────────────────── */}
        <div className="cd-header-card">
          <div className="cd-header-avatar">{initials}</div>

          <div className="cd-header-info">
            <h1 className="cd-header-name">
              {client.name || <span className="cd-muted">No name</span>}
            </h1>
            <p className="cd-header-phone"><PhoneIcon /> {formatPhone(phone)}</p>
            {client.address && <p className="cd-header-address"><PinIcon /> {client.address}</p>}
            {userDoc?.lastLogin && (
              <p className="cd-header-login"><ClockIcon /> Last login {formatDate(userDoc.lastLogin)}</p>
            )}

            {/* Claim number */}
            <div className="cd-header-claim-info">
              <span className="cd-header-adj-label"><ClaimIcon /> Claim #</span>
              {editingClaim ? (
                <form onSubmit={saveClaimNumber} style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <input className="cd-claim-input" value={editClaimValue}
                    onChange={e => setEditClaimValue(e.target.value)}
                    placeholder="Claim number" autoFocus />
                  <button type="submit" className="cd-claim-add-btn" disabled={savingClaim}>
                    {savingClaim ? "…" : "Save"}
                  </button>
                  <button type="button" className="cd-claim-cancel-btn" onClick={() => setEditingClaim(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <span className="cd-header-claim-num" style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {claimNumber || <span style={{ color:"#94a3b8", fontWeight:400 }}>Not set</span>}
                  <button className="cd-claim-edit-btn" title="Edit claim number"
                    onClick={() => { setEditClaimValue(claimNumber); setEditingClaim(true); }}>
                    <EditIcon />
                  </button>
                </span>
              )}
            </div>

            {/* Adjuster */}
            <div className="cd-header-adj-section">
              <div className="cd-header-adj-meta">
                <span className="cd-header-adj-label"><AdjusterIcon /> Insurance Adjuster</span>
                {!editingAdjuster && (
                  <button className="cd-header-adj-edit-btn"
                    onClick={() => { setAdjusterEdit({ ...adjuster }); setEditingAdjuster(true); }}>
                    <EditIcon />
                  </button>
                )}
              </div>
              {editingAdjuster ? (
                <form className="cd-header-adj-form" onSubmit={saveAdjuster}>
                  <div className="cd-header-adj-fields">
                    <input className="cd-header-adj-input" placeholder="Name" value={adjusterEdit.name}
                      onChange={e => setAdjusterEdit(a => ({ ...a, name: e.target.value }))} />
                    <input className="cd-header-adj-input" placeholder="Company" value={adjusterEdit.company}
                      onChange={e => setAdjusterEdit(a => ({ ...a, company: e.target.value }))} />
                    <input className="cd-header-adj-input" placeholder="Phone" value={adjusterEdit.phone}
                      onChange={e => setAdjusterEdit(a => ({ ...a, phone: e.target.value }))} />
                    <input className="cd-header-adj-input" placeholder="Email" value={adjusterEdit.email}
                      onChange={e => setAdjusterEdit(a => ({ ...a, email: e.target.value }))} />
                    <input className="cd-header-adj-input cd-header-adj-input-full" placeholder="Notes"
                      value={adjusterEdit.notes}
                      onChange={e => setAdjusterEdit(a => ({ ...a, notes: e.target.value }))} />
                  </div>
                  <div className="cd-header-adj-actions">
                    <button type="button" className="cd-btn-secondary" onClick={() => setEditingAdjuster(false)}>Cancel</button>
                    <button type="submit" className="cd-btn-primary" disabled={savingAdjuster}>
                      {savingAdjuster ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              ) : adjuster.name ? (
                <div className="cd-header-adj-detail">
                  <p className="cd-header-adj-name">
                    <PersonIcon /> {adjuster.name}{adjuster.company && ` · ${adjuster.company}`}
                  </p>
                  {adjuster.phone && <p className="cd-header-adj-line"><PhoneIcon /> {adjuster.phone}</p>}
                  {adjuster.email && (
                    <p className="cd-header-adj-line">
                      <EmailIcon /> <a href={`mailto:${adjuster.email}`} className="cd-header-adj-link">{adjuster.email}</a>
                    </p>
                  )}
                  {adjuster.notes && <p className="cd-header-adj-notes">{adjuster.notes}</p>}
                </div>
              ) : (
                <button className="cd-header-adj-add-btn"
                  onClick={() => { setAdjusterEdit({ ...adjuster }); setEditingAdjuster(true); }}>
                  <PlusIcon /> Add adjuster info
                </button>
              )}
            </div>
          </div>

          {/* Header right-side actions */}
          <div className="cd-header-actions">
            {hasPortal && <span className="cd-active-badge"><ActiveDotIcon /> Portal Active</span>}
            <button
              className={`cd-docs-nav-btn${showDocsDrawer ? " active" : ""}`}
              onClick={() => setShowDocsDrawer(v => !v)}>
              <DocIcon /> Documents
              {docs.length > 0 && <span className="cd-docs-nav-count">{docs.length}</span>}
            </button>
            {phone && (
              <Link
                to={`/myclaim/opt-in-policy?phone=${encodeURIComponent(phone)}`}
                target="_blank"
                className="cd-notify-btn"
                style={{ textDecoration:'none', fontSize:'.8125rem' }}
                title="View SMS opt-in proof for this client">
                Opt-in Proof
              </Link>
            )}
            <div className="cd-notify-wrap" ref={notifyRef}>
              <button
                className={`cd-notify-btn${notifySent ? " cd-notify-sent" : ""}${notifyError ? " cd-notify-error" : ""}`}
                onClick={() => { setNotifyOpen(v => !v); setNotifyError(""); }}
                disabled={notifySending}>
                {notifySending ? <><span className="cd-notify-spinner" /> Sending…</>
                  : notifySent ? "✓ Sent"
                  : <><BellIcon /> Notify Client</>}
              </button>
              {notifyError && <div className="cd-notify-error-banner">⚠ {notifyError}</div>}
              {notifyOpen && (
                <div className="cd-notify-dropdown">
                  {[
                    { type:"portal_ready",    title:"Portal is ready",      desc:"Tell them their portal is live." },
                    { type:"new_todo",        title:"You have new tasks",    desc:"Alert them to pending to-dos." },
                    { type:"progress_update", title:"Progress update",       desc:"Share a claim update." },
                    { type:"review_request",  title:"Request Google review", desc:"Ask for a review." },
                  ].map(opt => (
                    <button key={opt.type} className="cd-notify-option" onClick={() => sendNotification(opt.type)}>
                      <BellIcon />
                      <span>
                        <span className="cd-notify-option-title">{opt.title}</span>
                        <span className="cd-notify-option-desc">{opt.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="cd-tabs">
          {[
            { key:"overview", label:"Overview"    },
            { key:"client",   label:"Client View" },
          ].map(t => (
            <button key={t.key} className={`cd-tab${activeTab === t.key ? " active" : ""}`}
              onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════ OVERVIEW TAB ══════════════ */}
        {activeTab === "overview" && (
          <>
            {/* Claim info — editable by contractor */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <InfoIcon />
                <h2>Claim Information</h2>
                {!editingClientFields && hasPortal && (
                  <button className="cd-upload-btn" style={{ marginLeft:"auto" }}
                    onClick={() => { setClientFieldsEdit({ ...clientFields }); setEditingClientFields(true); setClientFieldsError(""); }}>
                    <EditIcon /> Edit
                  </button>
                )}
              </div>

              {editingClientFields ? (
                <form onSubmit={saveClientFields} style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 20px" }}>
                    <div>
                      <p className="cd-field-label">Claim Number</p>
                      <input className="cd-claim-input" style={{ width:"100%" }} placeholder="e.g. CLM-2024-00123"
                        value={clientFieldsEdit.claimNumber}
                        onChange={e => setClientFieldsEdit(v => ({ ...v, claimNumber: e.target.value }))} />
                    </div>
                    <div>
                      <p className="cd-field-label">Policy Number</p>
                      <input className="cd-claim-input" style={{ width:"100%" }} placeholder="e.g. POL-987654"
                        value={clientFieldsEdit.policyNumber}
                        onChange={e => setClientFieldsEdit(v => ({ ...v, policyNumber: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn:"1 / -1" }}>
                      <p className="cd-field-label">Home Address</p>
                      <input className="cd-claim-input" style={{ width:"100%" }} placeholder="123 Main St, City, State 12345"
                        ref={addressInputRef}
                        defaultValue={clientFieldsEdit.address} />
                    </div>
                    <div>
                      <p className="cd-field-label">Email</p>
                      <input className="cd-claim-input" style={{ width:"100%" }} type="email" placeholder="client@example.com"
                        value={clientFieldsEdit.email}
                        onChange={e => setClientFieldsEdit(v => ({ ...v, email: e.target.value }))} />
                    </div>
                    <div>
                      <p className="cd-field-label">Phone</p>
                      <input className="cd-claim-input" style={{ width:"100%", background:"#f8fafc", color:"#64748b", cursor:"not-allowed" }}
                        value={formatPhone(phone)} readOnly />
                    </div>
                  </div>
                  {clientFieldsError && <p style={{ margin:0, fontSize:13, color:"#dc2626" }}>{clientFieldsError}</p>}
                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <button type="button" className="cd-btn-secondary"
                      onClick={() => { setEditingClientFields(false); setClientFieldsError(""); }}>Cancel</button>
                    <button type="submit" className="cd-btn-primary" disabled={savingClientFields}>
                      {savingClientFields ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:20 }}>
                  {[
                    { label:"Client Name",  value: client.name || "—" },
                    { label:"Phone",        value: formatPhone(phone) },
                    { label:"Claim #",      value: clientFields.claimNumber  || "—" },
                    { label:"Policy #",     value: clientFields.policyNumber || "—" },
                    { label:"Email",        value: clientFields.email        || "—" },
                    { label:"Portal",       value: hasPortal ? "Active" : "Not activated" },
                  ].map(row => (
                    <div key={row.label}>
                      <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:".06em" }}>{row.label}</p>
                      <p style={{ margin:0, fontSize:14, color:"#0f172a", fontWeight:500, wordBreak:"break-word" }}>{row.value}</p>
                    </div>
                  ))}
                  {clientFields.address && (
                    <div style={{ gridColumn:"1 / -1" }}>
                      <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:".06em" }}>Home Address</p>
                      <p style={{ margin:0, fontSize:14, color:"#0f172a", fontWeight:500 }}>{clientFields.address}</p>
                    </div>
                  )}
                  {!hasPortal && (
                    <p className="cd-empty-msg" style={{ gridColumn:"1 / -1", marginTop:4 }}>
                      Client hasn't activated their portal yet. Fields can be edited once active.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="cd-section-card">
              <div className="cd-section-header"><InfoIcon /><h2>Summary</h2></div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:20 }}>
                {[
                  { label:"Open To-Dos",  value: `${todos.filter(t=>!t.completed).length} of ${todos.length}` },
                  { label:"Selections",   value: `${selections.length} item${selections.length !== 1 ? "s" : ""}` },
                  { label:"Documents",    value: `${docs.length} file${docs.length !== 1 ? "s" : ""}` },
                  { label:"Budget Est.",  value: budgetItems.length ? `$${budgetTotal.toFixed(2)}` : "—" },
                  { label:"Last Login",   value: userDoc?.lastLogin ? formatDate(userDoc.lastLogin) : "Never" },
                  { label:"Activity Log", value: `${activityLog.length} event${activityLog.length !== 1 ? "s" : ""}` },
                ].map(row => (
                  <div key={row.label}>
                    <p style={{ margin:"0 0 3px", fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:".06em" }}>{row.label}</p>
                    <p style={{ margin:0, fontSize:14, color:"#0f172a", fontWeight:500 }}>{row.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity log */}
            {activityLog.length > 0 && (
              <div className="cd-section-card">
                <div className="cd-section-header">
                  <ClockIcon2 /><h2>Activity Log</h2>
                  <span style={{ marginLeft:"auto", fontSize:12, color:"#94a3b8" }}>
                    {activityLog.length} event{activityLog.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ maxHeight: 116, overflowY:"auto", marginRight:-4, paddingRight:4 }}>
                  <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:0 }}>
                    {activityLog.map((event, idx) => (
                      <li key={event.id} style={{
                        display:"flex", alignItems:"flex-start", gap:12,
                        padding:"10px 0",
                        borderBottom: idx < activityLog.length - 1 ? "1px solid #f1f5f9" : "none",
                      }}>
                        <span style={{
                          flexShrink:0, marginTop:2, width:28, height:28,
                          borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
                          background: ACTIVITY_COLORS[event.type]?.bg || "#f1f5f9",
                          fontSize:13,
                        }}>
                          {ACTIVITY_ICONS[event.type] || "•"}
                        </span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ margin:"0 0 2px", fontSize:13, color:"#334155", fontWeight:500 }}>
                            {event.details || ACTIVITY_LABELS[event.type] || event.type}
                          </p>
                          <p style={{ margin:0, fontSize:11, color:"#94a3b8" }}>
                            {event.timestamp ? formatDateTime(event.timestamp) : "—"}
                            {event.actor && <span style={{ marginLeft:6, fontWeight:600, color:"#cbd5e1" }}>{event.actor}</span>}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════ CLIENT VIEW TAB ══════════════ */}
        {activeTab === "client" && (
          <>
            {/* Portal Visibility */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <EyeIcon />
                <h2>Portal Visibility {savingPortal && <span className="cd-saving">saving…</span>}</h2>
              </div>
              {!hasPortal && (
                <p className="cd-empty-msg">Client hasn't activated their portal yet. Sections will be shown once active.</p>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {Object.entries(PORTAL_SECTION_LABELS).map(([key, label]) => (
                  <label key={key} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!portalSections[key]} onChange={() => toggleSection(key)}
                      style={{ width:16, height:16, accentColor:"#2563eb" }} />
                    <span style={{ fontSize:14, color:"#334155" }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Claim Progress */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <ProgressIcon />
                <h2>Claim Progress {savingProg && <span className="cd-saving">saving…</span>}</h2>
              </div>
              <div className="cd-progress-block">
                <p className="cd-progress-label">Mitigation</p>
                <StepTracker steps={MITIGATION_STEPS} currentStep={mitStep}
                  onAdvance={() => advanceStep("mit")} onRegress={() => regressStep("mit")} saving={savingProg} />
              </div>
              <div className="cd-progress-block">
                <p className="cd-progress-label">Construction</p>
                <StepTracker steps={CONSTRUCTION_STEPS} currentStep={conStep}
                  onAdvance={() => advanceStep("con")} onRegress={() => regressStep("con")} saving={savingProg} />
              </div>
            </div>

            {/* Budget */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <BudgetIcon />
                <h2>Budget</h2>
                <button className="cd-upload-btn" style={{ marginLeft:"auto" }}
                  onClick={() => setShowBudgetForm(v => !v)}>
                  <PlusIcon /> Add Item
                </button>
              </div>

              {showBudgetForm && (
                <form className="cd-budget-form" onSubmit={addBudgetItem}>
                  <div className="cd-budget-search-wrap" style={{ position:"relative" }}>
                    <input className="cd-budget-search"
                      placeholder="Search item (e.g. Carpet, Drywall, Labor)…"
                      value={budgetSearch} autoFocus
                      onChange={e => { setBudgetSearch(e.target.value); setBudgetDropdown(true); setSelectedBudgetItem(null); }}
                      onFocus={() => setBudgetDropdown(true)} />
                    {budgetDropdown && budgetSearch && filteredBudgetItems.length > 0 && (
                      <div className="cd-budget-dropdown">
                        {filteredBudgetItems.map(item => (
                          <button type="button" key={item.label} className="cd-budget-dropdown-item"
                            onClick={() => { setSelectedBudgetItem(item); setBudgetSearch(item.label); setBudgetDropdown(false); }}>
                            {item.label}
                            <span className="cd-budget-dropdown-unit">{item.unit}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedBudgetItem && (
                    <>
                      <div className="cd-budget-price-row">
                        <div className="cd-budget-price-wrap">
                          <span className="cd-budget-dollar">$</span>
                          <input className="cd-budget-field-input" type="number" min="0" step="0.01"
                            placeholder="Price" value={budgetPrice} onChange={e => setBudgetPrice(e.target.value)} />
                        </div>
                        <select className="cd-budget-type-select" value={budgetPriceType}
                          onChange={e => setBudgetPriceType(e.target.value)}>
                          <option value="flat">Flat rate</option>
                          <option value="per_unit">Per {selectedBudgetItem.unit}</option>
                        </select>
                      </div>
                      {budgetPriceType === "per_unit" && (
                        <div className="cd-budget-qty-row">
                          <input className="cd-budget-field-input" style={{ width:90 }} type="number" min="0" step="0.01"
                            placeholder="Qty" value={budgetQty} onChange={e => setBudgetQty(e.target.value)} />
                          <span style={{ fontSize:13, color:"#64748b" }}>{selectedBudgetItem.unit}</span>
                          {budgetPrice && budgetQty && (
                            <span className="cd-budget-total-preview">
                              = ${((parseFloat(budgetPrice)||0)*(parseFloat(budgetQty)||1)).toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                      <input className="cd-budget-field-input" placeholder="Description (optional)"
                        value={budgetDesc} onChange={e => setBudgetDesc(e.target.value)} />
                    </>
                  )}

                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <button type="button" className="cd-btn-secondary"
                      onClick={() => { setShowBudgetForm(false); setBudgetSearch(""); setSelectedBudgetItem(null); }}>
                      Cancel
                    </button>
                    <button type="submit" className="cd-btn-primary"
                      disabled={!selectedBudgetItem || !budgetPrice || addingBudget}>
                      {addingBudget ? "Adding…" : "Add to Budget"}
                    </button>
                  </div>
                </form>
              )}

              {budgetItems.length === 0 ? (
                <p className="cd-empty-msg">No budget items yet.</p>
              ) : (
                <>
                  <ul className="cd-budget-list">
                    {budgetItems.map(item => (
                      <li key={item.id} className="cd-budget-list-item">
                        <div className="cd-budget-item-main">
                          <span className="cd-budget-item-name">{item.label}</span>
                          {item.description && <span className="cd-budget-item-desc">{item.description}</span>}
                        </div>
                        <div className="cd-budget-item-metrics">
                          {item.priceType === "per_unit" && item.qty && (
                            <span className="cd-budget-item-qty">{item.qty} {item.unit}</span>
                          )}
                          <span className="cd-budget-item-amount">${(item.total || 0).toFixed(2)}</span>
                        </div>
                        <button className="cd-todo-delete" onClick={() => deleteBudgetItem(item.id)} title="Remove">✕</button>
                      </li>
                    ))}
                  </ul>
                  <div className="cd-budget-total">
                    <span>Total Estimate</span>
                    <span className="cd-budget-total-amount">${budgetTotal.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {/* To-Dos */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <CheckIcon />
                <h2>To-Dos</h2>
                <button className="cd-upload-btn" style={{ marginLeft:"auto" }}
                  onClick={() => setShowTodoForm(v => !v)}>
                  <PlusIcon /> Add Task
                </button>
              </div>

              {showTodoForm && (
                <form className="cd-todo-type-form" onSubmit={addTodo}>
                  <div className="cd-todo-assign-row">
                    <span className="cd-todo-assign-label">Assign to:</span>
                    {["client","contractor"].map(who => (
                      <button key={who} type="button"
                        className={`cd-todo-assign-btn${todoAssigned === who ? " active" : ""}`}
                        onClick={() => setTodoAssigned(who)}>
                        {who.charAt(0).toUpperCase() + who.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="cd-todo-type-row">
                    {[
                      { type:"upload_file", icon:"📄", label:"Upload File"     },
                      { type:"selection",   icon:"🎨", label:"Make Selection"  },
                      { type:"general",     icon:"✓",  label:"General Task"    },
                    ].map(opt => (
                      <button key={opt.type} type="button"
                        className={`cd-todo-type-btn${todoType === opt.type ? " active" : ""}`}
                        onClick={() => setTodoType(opt.type)}>
                        <span>{opt.icon}</span>{opt.label}
                      </button>
                    ))}
                  </div>
                  <input className="cd-todo-input" placeholder="Task description…"
                    value={todoLabel} onChange={e => setTodoLabel(e.target.value)} autoFocus />
                  {todoError && <p className="cd-todo-error">{todoError}</p>}
                  <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                    <button type="button" className="cd-btn-secondary"
                      onClick={() => { setShowTodoForm(false); setTodoLabel(""); setTodoError(""); }}>
                      Cancel
                    </button>
                    <button type="submit" className="cd-btn-primary" disabled={addingTodo || !todoLabel.trim()}>
                      {addingTodo ? "Adding…" : "Add Task"}
                    </button>
                  </div>
                </form>
              )}

              {[
                { label:"Client Tasks",    items: clientTodos,     cls:"cd-todo-section-client"     },
                { label:"Contractor Tasks", items: contractorTodos, cls:"cd-todo-section-contractor" },
              ].map(({ label: grpLabel, items, cls }) => items.length > 0 && (
                <div key={grpLabel}>
                  <p className={`cd-todo-section-label ${cls}`}>{grpLabel}</p>
                  <ul className="cd-todo-list">
                    {items.map(todo => (
                      <li key={todo.id} className={`cd-todo-item${todo.completed ? " completed" : ""}`}>
                        <button className="cd-todo-check" onClick={() => toggleTodo(todo)}>
                          {todo.completed ? <CheckCircleFilledIcon /> : <CheckCircleEmptyIcon />}
                        </button>
                        <div className="cd-todo-body">
                          <span className="cd-todo-text">{todo.label}</span>
                        </div>
                        {todo.type && todo.type !== "general" && (
                          <span className={`cd-todo-type-badge cd-todo-type-${todo.type === "upload_file" ? "upload" : todo.type}`}>
                            {todo.type === "upload_file" ? "Upload" : "Selection"}
                          </span>
                        )}
                        <button className="cd-todo-delete" onClick={() => deleteTodo(todo.id)}>✕</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {todos.length === 0 && !showTodoForm && <p className="cd-empty-msg">No tasks yet.</p>}
            </div>

            {/* Selections */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <SelectionIcon />
                <h2>Client Selections</h2>
                <button className="cd-upload-btn" style={{ marginLeft:"auto" }}
                  onClick={() => setShowSelForm(v => !v)}>
                  <PlusIcon /> Add
                </button>
              </div>

              {showSelForm && (
                <form className="cd-sel-form" onSubmit={addSelection}>
                  <div className="cd-sel-row">
                    <select className="cd-sel-input" value={selCategory}
                      onChange={e => setSelCategory(e.target.value)} style={{ flex:"0 0 140px" }}>
                      {SELECTION_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input className="cd-sel-input" placeholder="Product / item name"
                      value={selProduct} onChange={e => setSelProduct(e.target.value)} required />
                  </div>
                  <input className="cd-sel-input" placeholder="URL (optional)"
                    value={selUrl} onChange={e => setSelUrl(e.target.value)} />
                  <input className="cd-sel-input" placeholder="Notes (optional)"
                    value={selNotes} onChange={e => setSelNotes(e.target.value)} />
                  <div className="cd-sel-form-actions">
                    <button type="button" className="cd-btn-secondary" onClick={() => setShowSelForm(false)}>Cancel</button>
                    <button type="submit" className="cd-btn-primary" disabled={savingSel || !selProduct.trim()}>
                      {savingSel ? "Saving…" : "Add Selection"}
                    </button>
                  </div>
                </form>
              )}

              {selections.length === 0 && !showSelForm ? (
                <p className="cd-empty-msg">No selections yet.</p>
              ) : (
                Object.entries(selByCategory).map(([cat, items]) => (
                  <div key={cat} className="cd-sel-group">
                    <p className="cd-sel-cat">{cat}</p>
                    {items.map(sel => (
                      <div key={sel.id} className="cd-sel-item">
                        <div className="cd-sel-item-info">
                          {sel.url
                            ? <a href={sel.url} target="_blank" rel="noreferrer" className="cd-sel-product">{sel.product}</a>
                            : <span className="cd-sel-product">{sel.product}</span>}
                          {sel.notes && <span className="cd-sel-notes">{sel.notes}</span>}
                        </div>
                        <SelStatusBadge status={sel.status} />
                        <div style={{ display:"flex", gap:6 }}>
                          {sel.status !== "approved" && (
                            <button className="cd-btn-primary" style={{ padding:"4px 10px", fontSize:12 }}
                              onClick={() => updateSelStatus(sel.id, "approved")}>✓ Approve</button>
                          )}
                          {sel.status !== "rejected" && (
                            <button className="cd-btn-secondary" style={{ padding:"4px 10px", fontSize:12 }}
                              onClick={() => updateSelStatus(sel.id, "rejected")}>✗ Reject</button>
                          )}
                          <button className="cd-todo-delete" onClick={() => deleteSel(sel.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* CompanyCam */}
            <div className="cd-section-card">
              <div className="cd-section-header">
                <CameraIcon />
                <h2>CompanyCam</h2>
                {isAdmin && ccProjectId ? (
                  <button className="cd-cc-unlink" onClick={unlinkCcProject}>Unlink</button>
                ) : isAdmin && !ccProjectId ? (
                  <>
                    <button className="cd-upload-btn" onClick={openCCPicker}>Link Project</button>
                    <button
                      className="cd-upload-btn"
                      onClick={handleCreateCCProject}
                      disabled={ccCreating || !clientFields.address && !client?.address}
                      style={{ marginLeft: 4 }}
                      title={clientFields.address || client?.address ? "Create a new CompanyCam project for this address" : "Add a client address first"}
                    >
                      {ccCreating ? "Creating…" : <><PlusIcon /> New</>}
                    </button>
                  </>
                ) : null}
              </div>

              {ccError && <p className="cd-cc-error">{ccError}</p>}

              {!ccProjectId ? (
                <p className="cd-empty-msg">No project linked. Link an existing project or create a new one using this client's address.</p>
              ) : (
                <>
                  <div className="cd-cc-project-info">
                    <span className="cd-cc-project-name">{ccProjectName || ccProjectId}</span>
                    <a
                      href={`https://app.companycam.com/projects/${ccProjectId}`}
                      target="_blank" rel="noreferrer"
                      className="cd-cc-open-link"
                    >
                      Open in CompanyCam ↗
                    </a>
                  </div>

                  {ccPhotoLoad ? (
                    <div className="cd-cc-photo-loading"><div className="cd-spinner" /></div>
                  ) : ccPhotos.length === 0 ? (
                    <p className="cd-empty-msg">No photos in this project yet.</p>
                  ) : (
                    <>
                      <div className="cd-cc-share-bar">
                        <span className="cd-cc-share-count">
                          <ClientVisibleIcon />
                          {ccSharedCount === 0
                            ? "No photos shared with client"
                            : ccSharedCount === ccPhotos.length
                            ? `All ${ccPhotos.length} photos shared with client`
                            : `${ccSharedCount} of ${ccPhotos.length} photos shared with client`}
                        </span>
                        <button className="cd-cc-manage-btn" onClick={() => setShowPhotoGrid(true)}>
                          <GridIcon /> Manage Photos
                        </button>
                      </div>
                      {ccSharedCount > 0 && (
                        <div className="cd-cc-photo-strip">
                          {ccPhotos.filter(p => isCCPhotoShared(p.id)).slice(0, 12).map(photo => {
                            const thumb = getThumb(photo);
                            return thumb ? (
                              <img key={photo.id} src={thumb} alt="" className="cd-cc-photo-thumb" />
                            ) : null;
                          })}
                          {ccSharedCount > 12 && (
                            <button className="cd-cc-more-tile" onClick={() => setShowPhotoGrid(true)}>
                              +{ccSharedCount - 12}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <div className="cd-cc-classify-bar">
                    <button
                      className="cd-cc-classify-btn"
                      onClick={handleClassify}
                      disabled={classifying || ccPhotos.length === 0}
                    >
                      {classifying
                        ? <><span className="cd-cc-btn-spin" /> Classifying…</>
                        : <><SparkleIcon /> Classify Photos</>
                      }
                    </button>
                    {classifyError && <p className="cd-cc-error" style={{ margin: 0 }}>{classifyError}</p>}
                  </div>

                  {classifyResults && !classifying && (
                    <div className="cd-cc-results">
                      {Object.entries(
                        classifyResults
                          .filter(r => r.best_match)
                          .reduce((acc, r) => { (acc[r.best_match] = acc[r.best_match] || []).push(r); return acc; }, {})
                      )
                        .sort(([, a], [, b]) => b.length - a.length)
                        .map(([label, items]) => (
                          <div key={label} className="cd-cc-result-group">
                            <div className="cd-cc-result-header">
                              <span className="cd-cc-result-count">{items.length}</span>
                              <span className="cd-cc-result-label-text">{label}</span>
                              <span className="cd-cc-result-avg">
                                avg {Math.round(items.reduce((s, r) => s + (r.similarity_score || 0), 0) / items.length * 100)}%
                              </span>
                            </div>
                            <div className="cd-cc-result-strip">
                              {items.slice(0, 8).map((r, i) => (
                                <a key={i} href={r.image_url} target="_blank" rel="noreferrer">
                                  <img src={r.image_url} alt={label} className="cd-cc-result-thumb" />
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Danger zone */}
            <div className="cd-danger-zone">
              {confirmDelete ? (
                <div className="cd-delete-confirm">
                  <p className="cd-delete-confirm-msg">
                    Permanently delete <strong>{client.name || phone}</strong>? This removes all their data and cannot be undone.
                  </p>
                  <div className="cd-delete-confirm-actions">
                    <button className="cd-btn-secondary" onClick={() => setConfirmDelete(false)} disabled={deletingClient}>
                      Cancel
                    </button>
                    <button className="cd-btn-danger" onClick={doDeleteClient} disabled={deletingClient}>
                      {deletingClient ? "Deleting…" : "Yes, Delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="cd-delete-claim-btn" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon /> Delete Client
                </button>
              )}
            </div>
          </>
        )}


      </div>

      {/* ── CompanyCam Project Picker ─────────────────────────────────── */}
      {showCCPicker && (
        <div className="cd-modal-overlay" onClick={() => setShowCCPicker(false)}>
          <div className="cd-cc-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-cc-modal-header">
              <CameraIcon />
              <h3>Select CompanyCam Project</h3>
              <button className="cd-modal-close" onClick={() => setShowCCPicker(false)}>✕</button>
            </div>
            <input
              className="cd-cc-search"
              placeholder="Search by address…"
              value={ccSearch}
              onChange={e => setCcSearch(e.target.value)}
              autoFocus
            />
            <div className="cd-cc-proj-list">
              {ccProjLoad ? (
                <div className="cd-cc-photo-loading"><div className="cd-spinner" /></div>
              ) : ccError ? (
                <p className="cd-cc-error" style={{ margin: "12px 16px" }}>{ccError}</p>
              ) : ccProjects.filter(p => {
                  const a = p.address || {};
                  const addr = [a.street_address_1, a.city, a.state, a.postal_code].filter(Boolean).join(' ');
                  return addr.toLowerCase().includes(ccSearch.toLowerCase()) || p.name?.toLowerCase().includes(ccSearch.toLowerCase());
                }).length === 0 ? (
                <p className="cd-empty-msg" style={{ padding: "16px" }}>No projects found.</p>
              ) : (
                ccProjects
                  .filter(p => {
                    const a = p.address || {};
                    const addr = [a.street_address_1, a.city, a.state, a.postal_code].filter(Boolean).join(' ');
                    return addr.toLowerCase().includes(ccSearch.toLowerCase()) || p.name?.toLowerCase().includes(ccSearch.toLowerCase());
                  })
                  .map(p => {
                    const a = p.address || {};
                    const addr = [a.street_address_1, a.city, a.state, a.postal_code].filter(Boolean).join(', ');
                    return (
                      <button key={p.id} className="cd-cc-proj-item" onClick={() => linkCCProject(p)}>
                        <CameraIcon />
                        <span style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:2 }}>
                          <span>{addr || p.name}</span>
                          {addr && <span style={{ fontSize:11, color:"#94a3b8" }}>{p.name}</span>}
                        </span>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Grid Modal ───────────────────────────────────────────── */}
      {showPhotoGrid && (
        <div className="cd-modal-overlay" onClick={() => setShowPhotoGrid(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff',
            borderRadius: 12,
            width: 700,
            maxWidth: '95vw',
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
              <CameraIcon />
              <span style={{ fontWeight:700, fontSize:15, color:'#1e293b', flex:1 }}>{ccProjectName || "CompanyCam Photos"}</span>
              <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', padding:'3px 10px', borderRadius:20 }}>
                {ccSharedCount === 0 ? "None shared" : ccSharedCount === ccPhotos.length ? `All ${ccPhotos.length} shared` : `${ccSharedCount} / ${ccPhotos.length} shared`}
              </span>
              <button className="cd-btn-secondary cd-photo-grid-ctrl-btn" onClick={clearAllPhotos}>Hide All</button>
              <button className="cd-btn-primary cd-photo-grid-ctrl-btn" onClick={shareAllPhotos}>Share All</button>
              <button className="cd-modal-close" onClick={() => setShowPhotoGrid(false)}>✕</button>
            </div>

            {/* Photo grid */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: 16,
              overflowY: 'auto',
              alignContent: 'flex-start',
            }}>
              {ccPhotos.map(photo => {
                const thumb = getThumb(photo);
                const shared = isCCPhotoShared(photo.id);
                if (!thumb) return null;
                return (
                  <div
                    key={photo.id}
                    onClick={() => togglePhotoSelection(photo.id)}
                    style={{
                      width: 150,
                      height: 150,
                      flexShrink: 0,
                      borderRadius: 6,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: `3px solid ${shared ? '#2563eb' : '#e2e8f0'}`,
                      position: 'relative',
                    }}
                  >
                    <img src={thumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                    {shared && (
                      <div style={{
                        position:'absolute', top:6, right:6,
                        width:22, height:22, borderRadius:'50%',
                        background:'#2563eb', color:'#fff',
                        fontSize:13, fontWeight:700,
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>✓</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ padding:'12px 16px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
              <button className="cd-btn-primary" style={{ padding:'8px 28px', fontSize:14 }} onClick={() => setShowPhotoGrid(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Documents Drawer ──────────────────────────────────────────── */}
      {showDocsDrawer && (
        <>
          <div className="cd-docs-overlay" onClick={() => setShowDocsDrawer(false)} />
          <div className="cd-docs-drawer">
            <div className="cd-docs-drawer-header">
              <DocIcon />
              <h2>Documents</h2>
              <span className="cd-docs-drawer-subtitle">{client.name || phone}</span>
              <button className="cd-docs-drawer-close" onClick={() => setShowDocsDrawer(false)}>✕</button>
            </div>

            {/* Google Drive section */}
            <div className="cd-docs-drawer-section" style={{ borderBottom:'1px solid #f0f0f0', paddingBottom:12, marginBottom:4 }}>
              <div className="cd-docs-drawer-section-header" style={{ marginBottom:6 }}>
                <span className="cd-docs-drawer-section-title" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <svg width="16" height="16" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
                    <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                    <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.2z" fill="#ea4335"/>
                    <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                    <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684fc"/>
                    <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                  </svg>
                  Google Drive
                </span>
                {driveConnected && !driveFolderUrl && isAdmin && (
                  <button className="cd-upload-btn" onClick={setupDriveFolder} disabled={driveSetupLoading}>
                    {driveSetupLoading ? 'Creating…' : 'Set up folder'}
                  </button>
                )}
              </div>
              {!driveConnected ? (
                <p className="cd-docs-drawer-empty" style={{ fontSize:12 }}>
                  {isAdmin
                    ? <>Google Drive not connected — go to <strong>Team → Integrations</strong> to connect.</>
                    : 'Google Drive not connected. Ask your admin to connect it.'}
                </p>
              ) : driveFolderUrl ? (
                <>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <a href={driveFolderUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize:12, color:'#2563eb', textDecoration:'none', display:'flex', alignItems:'center', gap:4 }}>
                      Open client folder ↗
                    </a>
                    {driveExternalId && (
                      <a href={`https://drive.google.com/drive/folders/${driveExternalId}`} target="_blank" rel="noreferrer"
                        style={{ fontSize:12, color:'#16a34a', textDecoration:'none' }}>
                        External ↗
                      </a>
                    )}
                    {driveInternalId && (
                      <a href={`https://drive.google.com/drive/folders/${driveInternalId}`} target="_blank" rel="noreferrer"
                        style={{ fontSize:12, color:'#9333ea', textDecoration:'none' }}>
                        Internal ↗
                      </a>
                    )}
                    <button
                      className="cd-upload-btn"
                      onClick={syncFromDrive}
                      disabled={driveSyncing}
                      style={{ marginLeft:'auto' }}
                    >
                      {driveSyncing ? 'Syncing…' : '↻ Sync from Drive'}
                    </button>
                  </div>
                  {driveSyncMessage && (
                    <p style={{ fontSize:11, marginTop:4, color: driveSyncMessage.startsWith('Synced') ? '#16a34a' : '#64748b' }}>
                      {driveSyncMessage}
                    </p>
                  )}
                </>
              ) : (
                <p className="cd-docs-drawer-empty" style={{ fontSize:12 }}>
                  {isAdmin ? 'No Drive folder yet — click "Set up folder" above.' : 'Drive folder not set up for this client yet.'}
                </p>
              )}
              {driveError && <p style={{ color:'#dc2626', fontSize:12, marginTop:4 }}>{driveError}</p>}
            </div>

            {/* Client-visible files */}
            <div className="cd-docs-drawer-section">
              <div className="cd-docs-drawer-section-header">
                <span className="cd-docs-drawer-section-title">Client Files</span>
                <span className="cd-docs-drawer-section-hint">Visible to client</span>
                <input ref={fileInputRef} type="file" hidden
                  onChange={e => { if (e.target.files[0]) uploadDoc(e.target.files[0], "client"); e.target.value = ""; }} />
                <button className="cd-upload-btn"
                  onClick={() => fileInputRef.current?.click()} disabled={uploading || !clientUid}>
                  {uploading ? "Uploading…" : <><UploadIcon /> Upload</>}
                </button>
              </div>
              {!clientUid && <p className="cd-docs-drawer-empty">Client must activate portal first.</p>}
              {docs.filter(d => d.folder !== "internal").length === 0
                ? <p className="cd-docs-drawer-empty">No files yet.</p>
                : (
                  <ul className="cd-doc-list">
                    {docs.filter(d => d.folder !== "internal").map(d => (
                      <li key={d.id} className="cd-doc-item">
                        <DocIcon />
                        <div className="cd-doc-info">
                          <a href={d.downloadURL} target="_blank" rel="noreferrer" className="cd-doc-name">{d.name}</a>
                          <div className="cd-doc-meta">
                            {d.size && <span className="cd-doc-size">{formatBytes(d.size)}</span>}
                            {d.uploadedAt && <span className="cd-doc-size">{formatDate(d.uploadedAt)}</span>}
                          </div>
                        </div>
                        <button className="cd-doc-delete" onClick={() => deleteDocument(d)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>

            {/* Internal-only files */}
            <div className="cd-docs-drawer-section">
              <div className="cd-docs-drawer-section-header">
                <span className="cd-docs-drawer-section-title">Internal Files</span>
                <span className="cd-docs-drawer-section-hint">Not visible to client</span>
                <input ref={contractorFileRef} type="file" hidden
                  onChange={e => { if (e.target.files[0]) uploadDoc(e.target.files[0], "internal"); e.target.value = ""; }} />
                <button className="cd-upload-btn"
                  onClick={() => contractorFileRef.current?.click()} disabled={contractorUploading || !clientUid}>
                  {contractorUploading ? "Uploading…" : <><UploadIcon /> Upload</>}
                </button>
              </div>
              {docs.filter(d => d.folder === "internal").length === 0
                ? <p className="cd-docs-drawer-empty">No internal files.</p>
                : (
                  <ul className="cd-doc-list">
                    {docs.filter(d => d.folder === "internal").map(d => (
                      <li key={d.id} className="cd-doc-item">
                        <DocIcon />
                        <div className="cd-doc-info">
                          <a href={d.downloadURL} target="_blank" rel="noreferrer" className="cd-doc-name">{d.name}</a>
                          <div className="cd-doc-meta">
                            {d.size && <span className="cd-doc-size">{formatBytes(d.size)}</span>}
                          </div>
                        </div>
                        <button className="cd-doc-delete" onClick={() => deleteDocument(d)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Step Tracker ──────────────────────────────────────────────────────────────
function StepTracker({ steps, currentStep, onAdvance, onRegress, saving }) {
  return (
    <div>
      <div className="cd-steps">
        {steps.map((label, i) => {
          const done   = i <= currentStep;
          const active = i === currentStep + 1;
          return (
            <div key={i} className={`cd-step${done ? " done" : active ? " active" : ""}`}>
              <div className="cd-step-row">
                <div className={`cd-seg left${i === 0 ? " hidden" : ""}`} />
                <div className="cd-step-node">{done ? "✓" : i + 1}</div>
                <div className={`cd-seg right${i === steps.length - 1 ? " hidden" : ""}`} />
              </div>
              <span className="cd-step-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:10 }}>
        <button className="cd-btn-secondary" style={{ padding:"5px 12px", fontSize:12 }}
          onClick={onRegress} disabled={saving || currentStep < 0}>← Back</button>
        <button className="cd-btn-primary" style={{ padding:"5px 14px", fontSize:12 }}
          onClick={onAdvance} disabled={saving || currentStep >= steps.length - 1}>Advance →</button>
      </div>
    </div>
  );
}

// ── Selection status badge ────────────────────────────────────────────────────
function SelStatusBadge({ status }) {
  const map = {
    approved:       { bg:"#f0fdf4", color:"#16a34a", label:"Approved" },
    rejected:       { bg:"#fef2f2", color:"#dc2626", label:"Rejected" },
    needs_approval: { bg:"#fefce8", color:"#ca8a04", label:"Pending"  },
  };
  const s = map[status] || map.needs_approval;
  return (
    <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6, background:s.bg, color:s.color, flexShrink:0 }}>
      {s.label}
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const BackIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
const PhoneIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.03 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>;
const PinIcon      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const ClockIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const ClaimIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>;
const EditIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const AdjusterIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const PersonIcon   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const EmailIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" style={{flexShrink:0}}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
const PlusIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const DocIcon      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const UploadIcon   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>;
const BellIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
const InfoIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const EyeIcon      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const ProgressIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
const BudgetIcon   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
const CheckIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
const SelectionIcon= () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>;
const CameraIcon   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const TrashIcon    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>;
const ActiveDotIcon= () => <svg viewBox="0 0 8 8" width="7" height="7" fill="currentColor"><circle cx="4" cy="4" r="4"/></svg>;
const ClockIcon2  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const CheckCircleFilledIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="#16a34a"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm-1 14.5l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z"/></svg>;
const CheckCircleEmptyIcon  = () => <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/></svg>;
const SparkleIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
const GridIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
const ClientVisibleIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;

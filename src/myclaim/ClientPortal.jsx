import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { auth, db, storage } from "../firebase";
import { loadGoogleMaps } from "./loadMaps";

const API = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");
import {
  collection, getDocs, getDoc, addDoc, deleteDoc, doc, serverTimestamp,
  updateDoc, setDoc, query, orderBy, where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import "./ClientPortal.css";
import SigningModal from "./SigningModal";

// ── Icons ────────────────────────────────────────────────────────────────────
const CheckIcon      = ({size=14}) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><polyline points="20 6 9 17 4 12"/></svg>;
const LockIcon       = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const EditIcon       = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const DocIcon        = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>;
const UploadIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="26" height="26"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>;
const UploadTodoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6M9 15l3 3 3-3"/></svg>;
const GridIcon       = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
const PenIcon        = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
const ChevronIcon    = ({className}) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><polyline points="6 9 12 15 18 9"/></svg>;
const ExternalLinkIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11" style={{marginLeft:3,flexShrink:0}}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const PersonIcon     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const EmailIcon      = ({size=13}) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
const HomeIcon       = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const PhoneIcon      = ({size=13}) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.87a19.79 19.79 0 01-3-8.59A2 2 0 012.11 1H5.1a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91A16 16 0 0015.1 17.9l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 18.92z"/></svg>;
const MapPinIcon     = ({size=13}) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;

// ── Helpers ───────────────────────────────────────────────────────────────────
const InfoCell = ({ label, value, full }) => (
  <div className={`cp-info-cell${full?" cp-info-cell--full":""}`}>
    <div className="cp-info-label">{label}</div>
    <div className={`cp-info-value${!value?" cp-info-value--empty":""}`}>{value||"Not set"}</div>
  </div>
);

const TypewriterName = ({ name }) => {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed(""); if (!name) return;
    let i=0;
    const id = setInterval(() => { i++; setDisplayed(name.slice(0,i)); if (i>=name.length) clearInterval(id); }, 65);
    return () => clearInterval(id);
  }, [name]);
  return <span>{displayed}</span>;
};

const fileType = (name="") => { const ext=name.split(".").pop().toLowerCase(); if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "image"; if (ext==="pdf") return "pdf"; if (["doc","docx"].includes(ext)) return "word"; if (["xls","xlsx","csv"].includes(ext)) return "excel"; return "file"; };
const formatShortDate = (ts) => { if (!ts) return ""; const d=ts instanceof Date?ts:ts.toDate?.()??( ts.seconds?new Date(ts.seconds*1000):null); if (!d) return ""; return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const formatPhone = (raw="") => { const digits=raw.replace(/\D/g,""); const d=digits.length===11&&digits.startsWith("1")?digits.slice(1):digits; if (d.length!==10) return raw; return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`; };
const formatBytes = (bytes) => { if (bytes<1024) return `${bytes} B`; if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/(1024*1024)).toFixed(1)} MB`; };
const FileTypeIcon = ({type}) => { const colors={pdf:"#ef4444",word:"#2563eb",excel:"#16a34a",file:"#64748b"}; const labels={pdf:"PDF",word:"DOC",excel:"XLS",file:"FILE"}; return <div className="cp-filetype" style={{background:colors[type]||colors.file}}>{labels[type]||"FILE"}</div>; };

const SELECTION_CATEGORIES = [
  "Roofing","Siding","Windows","Flooring",
  "Cabinets","Countertops","Fixtures","Paint","Other",
];

const TODO_TYPE_INFO = {
  upload_file:      { label: "Upload a file",                 Icon: UploadTodoIcon  },
  add_selection:    { label: "Add a selection",               Icon: GridIcon        },
  sign_forms:       { label: "Sign authorization forms",      Icon: PenIcon         },
  review_selection: { label: "Review a contractor selection", Icon: GridIcon        },
};

const MITIGATION_STEPS    = ["Claim Submitted","Mitigation in Progress","Mitigation Completed","Estimate Submitted","Estimate Approved"];
const CONSTRUCTION_STEPS  = ["Construction Estimate Received","Construction Estimate Approved","Construction Beginning","Construction Completes"];
const PORTAL_DEFAULTS     = { todos:true, mitigationProgress:true, constructionProgress:true, budget:true, selections:true, photos:true };

// ── Progress tracker component ──────────────────────────────────────────────
function ProgressTracker({ steps, currentStep = -1 }) {
  return (
    <div className="cp-steps">
        {steps.map((label, i) => {
          const done = i < currentStep, active = i === currentStep;
          const state = done ? "done" : active ? "active" : "pending";
          return (
            <div key={label} className={`cp-step ${state}`}>
              <div className="cp-step-row">
                <div className={`cp-step-seg left${i === 0 ? " invis" : ""}`} />
                <div className="cp-step-wrap">
                  <div className="cp-step-node">{done ? <CheckIcon size={12} /> : i + 1}</div>
                </div>
                <div className={`cp-step-seg right${i === steps.length - 1 ? " invis" : ""}`} />
              </div>
              <span className="cp-step-name">{label}</span>
            </div>
          );
        })}
    </div>
  );
}

export default function ClientPortal() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const phone = user?.phoneNumber || "";

  const [sidebarOpen,      setSidebarOpen]      = useState(false);
  const [documents,        setDocuments]        = useState([]);
  const [uploading,        setUploading]        = useState(false);
  const [uploadError,      setUploadError]      = useState("");
  const [docError,         setDocError]         = useState("");
  const [pendingFile,      setPendingFile]      = useState(null);
  const [pendingFileName,  setPendingFileName]  = useState("");
  const [preview,          setPreview]          = useState(null);
  const [todos,            setTodos]            = useState([]);
  const [selections,       setSelections]       = useState([]);
  const [linkPreviews,     setLinkPreviews]     = useState({});
  const [openSections,     setOpenSections]     = useState(new Set());
  const [claimProgress,    setClaimProgress]    = useState({ mitigationStep:-1, constructionStep:-1 });
  const [customerName,     setCustomerName]     = useState("");
  const [claimInfo,        setClaimInfo]        = useState({ claimNumber:"", policyNumber:"", address:"", email:"" });
  const [adjuster,         setAdjuster]         = useState({ name:"", company:"", phone:"", email:"" });
  const [editingInfo,      setEditingInfo]      = useState(false);
  const [infoEdit,         setInfoEdit]         = useState({ claimNumber:"", policyNumber:"", address:"", email:"" });
  const [adjusterEdit,     setAdjusterEdit]     = useState({ name:"", company:"", phone:"", email:"" });
  const [savingInfo,       setSavingInfo]       = useState(false);
  const [infoError,        setInfoError]        = useState("");
  const [orgInfo,          setOrgInfo]          = useState(null);
  const [contractors,      setContractors]      = useState([]);
  const [orgId,            setOrgId]            = useState(null);
  const [companyCamProjectId,   setCompanyCamProjectId]   = useState(null);
  const [companyCamProjectName, setCompanyCamProjectName] = useState("");
  const [photos,           setPhotos]           = useState([]);
  const [photosLoading,    setPhotosLoading]    = useState(false);
  const [photosError,      setPhotosError]      = useState("");
  const [clientPhotoIds,   setClientPhotoIds]   = useState(null);
  const [photoLightboxIdx, setPhotoLightboxIdx] = useState(null);
  const [showPhotoPopup,   setShowPhotoPopup]   = useState(false);
  const photoTouchX = useRef(null);
  const [portalSections, setPortalSections] = useState(PORTAL_DEFAULTS);
  const [budgetItems,    setBudgetItems]    = useState([]);
  const [showDoneTodos,  setShowDoneTodos]  = useState(false);
  const [driveConnected,        setDriveConnected]        = useState(false);
  const [driveExternalFolderId, setDriveExternalFolderId] = useState('');
  const [clientDocId,           setClientDocId]           = useState('');
  const [showAddSel,     setShowAddSel]     = useState(false);
  const [selCategory,    setSelCategory]    = useState(SELECTION_CATEGORIES[0]);
  const [selProduct,     setSelProduct]     = useState("");
  const [selUrl,         setSelUrl]         = useState("");
  const [selNotes,       setSelNotes]       = useState("");
  const [addingSel,      setAddingSel]      = useState(false);
  const [selError,       setSelError]       = useState("");
  const [swapTargetId,   setSwapTargetId]   = useState(null);
  const [pickTodoId,     setPickTodoId]     = useState(null);
  const [reviewingSel,   setReviewingSel]   = useState(null);
  const [approveUrl,     setApproveUrl]     = useState("");
  const [approveNotes,   setApproveNotes]   = useState("");
  const [editingSel,     setEditingSel]     = useState(null);
  const [editSelProduct, setEditSelProduct] = useState("");
  const [editSelUrl,     setEditSelUrl]     = useState("");
  const [editSelNotes,   setEditSelNotes]   = useState("");
  const [editSelCategory,setEditSelCategory]= useState(SELECTION_CATEGORIES[0]);
  const [savingEditSel,  setSavingEditSel]  = useState(false);
  const [editSelError,   setEditSelError]   = useState("");
  const [signingTodo,    setSigningTodo]    = useState(null);

  const fileInputRef    = useRef(null);
  const addressInputRef = useRef(null);
  const addressAutoRef  = useRef(null);

  const logActivity = async (type, details) => {
    if (!user) return;
    try { await addDoc(collection(db,"users",user.uid,"activity"), { type, details, timestamp:serverTimestamp(), actor:"client" }); }
    catch {}
  };

  const syncToOrgPath = async (collName, item, updates) => {
    if (!orgId || !clientDocId) return;
    await setDoc(doc(db, "organization_data", orgId, "clients", clientDocId, collName, item.id), updates, { merge: true });
  };

  // ── Load claim data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        await setDoc(doc(db,"users",user.uid), { phoneNumber:user.phoneNumber, lastLogin:serverTimestamp() }, { merge:true });
        addDoc(collection(db,"users",user.uid,"activity"), { type:"login", details:"Client accessed the portal", timestamp:serverTimestamp(), actor:"client" }).catch(()=>{});
        const snap = await getDoc(doc(db,"users",user.uid));
        const data = snap.exists() ? snap.data() : {};
        if (data.displayName) setCustomerName(data.displayName);
        setClaimProgress({ mitigationStep: data.mitigationStep ?? -1, constructionStep: data.constructionStep ?? -1 });
        setPortalSections({ ...PORTAL_DEFAULTS, ...(data.portalSections||{}) });
        const info = { claimNumber: data.claimNumbers?.[0]||data.claimNumber||"", policyNumber: data.policyNumber||"", address: data.address||"", email: data.email||"" };
        setClaimInfo(info); setInfoEdit(info);
        const adj = { name: data.adjuster?.name||"", company: data.adjuster?.company||"", phone: data.adjuster?.phone||"", email: data.adjuster?.email||"" };
        setAdjuster(adj); setAdjusterEdit(adj);
        if (data.companyCamProjectId)   setCompanyCamProjectId(data.companyCamProjectId);
        if (data.companyCamProjectName) setCompanyCamProjectName(data.companyCamProjectName);
        if (data.selectedPhotoIds != null) setClientPhotoIds(data.selectedPhotoIds);
        let oid = data.organizationId;
        let preloadedClientDocId = data.clientDocId || null;
        if (!oid && phone) {
          const cpSnap = await getDoc(doc(db,"client_phones",phone));
          if (cpSnap.exists()) {
            const cpData = cpSnap.data();
            oid = cpData.orgId || null;
            if (!preloadedClientDocId) preloadedClientDocId = cpData.clientDocId || null;
            if (oid) await setDoc(doc(db,"users",user.uid), { organizationId:oid }, { merge:true });
            if (cpData.driveExternalFolderId) setDriveExternalFolderId(cpData.driveExternalFolderId);
          }
        }
        if (!oid) return;
        setOrgId(oid);
        if (preloadedClientDocId) setClientDocId(preloadedClientDocId);
        const [orgSnap, ctorSnap] = await Promise.all([
          getDoc(doc(db,"organization_data",oid)),
          getDocs(collection(db,"organization_data",oid,"contractors")),
        ]);
        if (orgSnap.exists()) {
          setOrgInfo(orgSnap.data());
          setDriveConnected(!!orgSnap.data().googleDriveConnected);
          try {
            const cSnap = await getDocs(query(collection(db,"organization_data",oid,"clients"), where("phone","==",phone)));
            if (!cSnap.empty) {
              const cData = cSnap.docs[0].data();
              const n = cData.name || cData.displayName || "";
              if (n) setCustomerName(n);
              setClientDocId(cSnap.docs[0].id);
              if (cData.driveExternalFolderId) setDriveExternalFolderId(cData.driveExternalFolderId);
              // Org client doc is the single source of truth for all claim data
              setClaimProgress({
                mitigationStep:   cData.mitigationStep  ?? -1,
                constructionStep: cData.constructionStep ?? -1,
              });
              const infoFromOrg = {
                claimNumber:  cData.claimNumbers?.[0] || cData.claimNumber || info.claimNumber || "",
                policyNumber: cData.policyNumber || info.policyNumber || "",
                address:      cData.address || info.address || "",
                email:        cData.email || info.email || "",
              };
              setClaimInfo(infoFromOrg);
              setInfoEdit(infoFromOrg);
              if (cData.adjuster) { setAdjuster(cData.adjuster); setAdjusterEdit(cData.adjuster); }
              if (cData.portalSections) setPortalSections({ ...PORTAL_DEFAULTS, ...cData.portalSections });
              if (cData.companyCamProjectId) {
                setCompanyCamProjectId(cData.companyCamProjectId);
                if (cData.companyCamProjectName) setCompanyCamProjectName(cData.companyCamProjectName);
                if (cData.selectedPhotoIds) setClientPhotoIds(cData.selectedPhotoIds);
              }
            }
          } catch {}
        }
        // Only show contractors relevant to this client:
        // admins (org owner or role=admin) are always visible;
        // project managers appear only if this client is in their assignedClients list.
        const ctors = [];
        ctorSnap.forEach(d => {
          const data = { uid: d.id, ...d.data() };
          const isAdminRole = data.role === 'admin' || !data.role || d.id === oid;
          const isAssigned  = (data.assignedClients || []).includes(phone);
          if (isAdminRole || isAssigned) ctors.push(data);
        });
        setContractors(ctors);
      } catch (err) { console.error("Error loading claim data:", err); }
    })();
  }, [user]);

  // Load all subcollections from org path — single source of truth
  useEffect(() => {
    if (!clientDocId || !orgId) return;
    Promise.all([
      getDocs(query(collection(db, "organization_data", orgId, "clients", clientDocId, "documents"),  orderBy("uploadedAt", "desc"))).catch(() => null),
      getDocs(query(collection(db, "organization_data", orgId, "clients", clientDocId, "todos"),      orderBy("createdAt",  "asc"))).catch(() => null),
      getDocs(query(collection(db, "organization_data", orgId, "clients", clientDocId, "selections"), orderBy("addedAt",    "asc"))).catch(() => null),
      getDocs(query(collection(db, "organization_data", orgId, "clients", clientDocId, "budget"),     orderBy("addedAt",    "asc"))).catch(() => null),
    ]).then(([docsSnap, todosSnap, selectionsSnap, budgetSnap]) => {
      if (docsSnap) setDocuments(docsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      if (todosSnap) setTodos(todosSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => t.assignedTo !== "contractor"));
      if (selectionsSnap) setSelections(selectionsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      if (budgetSnap) setBudgetItems(budgetSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(console.error);
  }, [clientDocId, orgId]);

  useEffect(() => {
    if (!companyCamProjectId || !orgId || !user) return;
    setPhotosLoading(true); setPhotosError("");
    user.getIdToken()
      .then(token => axios.post(`${API}/photos/companycam`,
        { projectId: companyCamProjectId, orgId },
        { headers: { Authorization: `Bearer ${token}` } }
      ))
      .then(r => { if (r.data.error) throw new Error(r.data.error); setPhotos(r.data.photos||[]); })
      .catch(e => setPhotosError(e.response?.data?.error || e.message || "Could not load photos."))
      .finally(() => setPhotosLoading(false));
  }, [companyCamProjectId, orgId, user]);

  useEffect(() => {
    const urls = [...new Set(selections.map(s=>s.url).filter(Boolean))];
    urls.forEach(async url => {
      setLinkPreviews(p => { if (p[url]) return p; return { ...p, [url]:"loading" }; });
      try { const r = await axios.post(`${API}/link-preview`, { url }); setLinkPreviews(p => ({ ...p, [url]:r.data })); }
      catch  { setLinkPreviews(p => ({ ...p, [url]:"error" })); }
    });
  }, [selections]);

  // ── Google Places ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editingInfo || !addressInputRef.current) return;
    let cancelled = false;
    const attach = () => {
      if (cancelled || !addressInputRef.current || addressAutoRef.current) return;
      addressAutoRef.current = new window.google.maps.places.Autocomplete(addressInputRef.current, { types:["address"], componentRestrictions:{ country:"us" } });
      addressAutoRef.current.addListener("place_changed", () => {
        const place = addressAutoRef.current.getPlace();
        if (place?.formatted_address && addressInputRef.current) addressInputRef.current.value = place.formatted_address;
      });
    };
    loadGoogleMaps().then(attach).catch(() => {});
    return () => {
      cancelled = true;
      if (addressAutoRef.current) { window.google?.maps?.event?.clearInstanceListeners(addressAutoRef.current); addressAutoRef.current = null; }
    };
  }, [editingInfo]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleTodo = async (todo) => {
    const nowDone = !todo.completed;
    const update = { completed:nowDone, ...(nowDone ? { completedAt:serverTimestamp() } : { completedAt:null }) };
    try {
      await syncToOrgPath("todos", todo, update);
      setTodos(p => p.map(t => t.id===todo.id ? { ...t, ...update } : t));
      await logActivity(nowDone?"todo_completed":"todo_uncompleted", `${nowDone?"Completed":"Reopened"} task: "${todo.label||todo.text||""}"`);
    } catch (err) { console.error(err); }
  };

  const addSelection = async (swapId=null, fromTodoId=null) => {
    if (!selProduct.trim()) { setSelError("Product name is required."); return; }
    setAddingSel(true); setSelError("");
    try {
      const payload = { category:selCategory, product:selProduct.trim(), url:selUrl.trim()||null, notes:selNotes.trim()||null, addedAt:serverTimestamp(), addedBy:"client", status:"approved" };
      if (fromTodoId) payload.fromTodoId = fromTodoId;
      const newRef = await addDoc(collection(db,"organization_data",orgId,"clients",clientDocId,"selections"), payload);
      if (swapId) {
        const swapSel = selections.find(s => s.id === swapId);
        if (swapSel) await syncToOrgPath("selections", swapSel, { status:"rejected" });
      }
      if (fromTodoId) {
        const todoUpd = { completed: true, completedAt: serverTimestamp() };
        const fromTodo = todos.find(t => t.id === fromTodoId);
        if (fromTodo) await syncToOrgPath("todos", fromTodo, todoUpd);
        setTodos(p => p.map(t => t.id===fromTodoId ? { ...t, ...todoUpd } : t));
      }
      setSelections(p => [...p, { id: newRef.id, ...payload }]);
      await logActivity("selection_added", `Added selection: "${selProduct.trim()}" (${selCategory})`);
      setShowAddSel(false); setSwapTargetId(null); setPickTodoId(null);
      setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelCategory(SELECTION_CATEGORIES[0]);
    } catch (err) { setSelError(err.message||"Could not save selection."); }
    finally { setAddingSel(false); }
  };

  const approveSelection = async (sel, urlOverride="", notesOverride=null) => {
    try {
      const updates = { status:"approved", approvedAt:serverTimestamp() };
      const trimmedUrl = (urlOverride||"").trim();
      if (trimmedUrl) updates.url = trimmedUrl;
      if (notesOverride !== null) updates.notes = (notesOverride||"").trim()||null;
      await syncToOrgPath("selections", sel, updates);
      setSelections(p => p.map(s => s.id===sel.id ? { ...s, ...updates } : s));
      await logActivity("selection_approved", `Approved selection: "${sel.product}" (${sel.category})`);
      const linked = todos.find(t => t.linkedSelectionId===sel.id && !t.completed);
      if (linked) { const u = { completed:true, completedAt:serverTimestamp() }; await syncToOrgPath("todos", linked, u); setTodos(p => p.map(t => t.id===linked.id ? { ...t, completed:true } : t)); }
    } catch (err) { console.error(err); }
  };

  const rejectSelection = async (sel) => {
    try {
      await syncToOrgPath("selections", sel, { status:"rejected" });
      setSelections(p => p.map(s => s.id===sel.id ? { ...s, status:"rejected" } : s));
      await logActivity("selection_rejected", `Rejected selection: "${sel.product}" (${sel.category})`);
      const linked = todos.find(t => t.linkedSelectionId===sel.id && !t.completed);
      if (linked) { const u = { completed:true, completedAt:serverTimestamp() }; await syncToOrgPath("todos", linked, u); setTodos(p => p.map(t => t.id===linked.id ? { ...t, completed:true } : t)); }
    } catch (err) { console.error(err); }
  };

  const openEditSel = (sel) => {
    setEditingSel(sel);
    setEditSelProduct(sel.product || "");
    setEditSelUrl(sel.url || "");
    setEditSelNotes(sel.notes || "");
    setEditSelCategory(sel.category || SELECTION_CATEGORIES[0]);
    setEditSelError("");
  };

  const saveEditSel = async () => {
    if (!editSelProduct.trim()) { setEditSelError("Product name is required."); return; }
    setSavingEditSel(true); setEditSelError("");
    const changed =
      editSelProduct.trim() !== editingSel.product ||
      (editSelUrl.trim() || null) !== editingSel.url ||
      (editSelNotes.trim() || null) !== editingSel.notes ||
      editSelCategory !== editingSel.category;
    if (!changed) { setEditingSel(null); setSavingEditSel(false); return; }
    try {
      const updates = {
        product: editSelProduct.trim(),
        url: editSelUrl.trim() || null,
        notes: editSelNotes.trim() || null,
        category: editSelCategory,
        updatedAt: serverTimestamp(),
      };
      await syncToOrgPath("selections", editingSel, updates);
      setSelections(p => p.map(s => s.id === editingSel.id ? { ...s, ...updates } : s));
      await logActivity("selection_updated", `Updated selection: "${editSelProduct.trim()}" (${editSelCategory})`);
      setEditingSel(null);
    } catch (err) { setEditSelError(err.message || "Could not save changes."); }
    finally { setSavingEditSel(false); }
  };

  const fetchDocuments = async () => {
    if (!orgId || !clientDocId) return; setDocError("");
    try {
      const s = await getDocs(query(collection(db,"organization_data",orgId,"clients",clientDocId,"documents"), orderBy("uploadedAt","desc")));
      setDocuments(s.docs.map(d => ({ id:d.id, ...d.data() })));
    }
    catch (err) { setDocError(err.message||"Could not load documents."); }
  };
  useEffect(() => { if (orgId && clientDocId) fetchDocuments(); }, [orgId, clientDocId]); // eslint-disable-line

  const markSigned = async (todo, signedDocumentUrl) => {
    if (!todo) return;
    try {
      const updates = { completed: true, completedAt: serverTimestamp() };
      if (signedDocumentUrl) updates.signedDocumentUrl = signedDocumentUrl;
      await syncToOrgPath("todos", todo, updates);
      setTodos(p => p.map(t =>
        t.id === todo.id ? { ...t, completed: true, ...(signedDocumentUrl ? { signedDocumentUrl } : {}) } : t
      ));
      setSigningTodo(null);
    } catch (err) { console.error("markSigned error:", err); }
  };

  const openSidebar = () => { fetchDocuments(); setSidebarOpen(true); };

  const handleUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setPendingFile(file); setPendingFileName(file.name.replace(/\.[^.]+$/,""));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const confirmUpload = async () => {
    if (!pendingFile||!user) return;
    setUploading(true); setUploadError("");
    try {
      const ext = pendingFile.name.includes(".") ? pendingFile.name.slice(pendingFile.name.lastIndexOf(".")) : "";
      const label = pendingFileName.trim() || pendingFile.name.replace(/\.[^.]+$/,"");
      const fileName = label + ext;
      const storagePath = orgId && clientDocId
        ? `users/${orgId}/documents/clients/${clientDocId}/${Date.now()}_${pendingFile.name}`
        : `users/${user.uid}/documents/${Date.now()}_${pendingFile.name}`;
      const sRef = ref(storage, storagePath);
      await uploadBytes(sRef, pendingFile);
      const downloadURL = await getDownloadURL(sRef);
      let docRef;
      if (orgId && clientDocId) {
        docRef = await addDoc(collection(db,"organization_data",orgId,"clients",clientDocId,"documents"), {
          name: fileName, storagePath: sRef.fullPath, downloadURL,
          size: pendingFile.size, folder: "client", uploadedAt: serverTimestamp(), uploadedBy: "client",
        });
      } else {
        docRef = await addDoc(collection(db,"users",user.uid,"documents"), {
          name: fileName, storagePath: sRef.fullPath, downloadURL,
          size: pendingFile.size, folder: "client", uploadedAt: serverTimestamp(),
        });
      }
      await logActivity("document_uploaded", `Uploaded document: "${fileName}"`);

      // Mirror to Google Drive (client uploads always go to External Files)
      if (driveConnected && orgId) {
        fetch(`${API}/integrations/google-drive/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            fileUrl:        downloadURL,
            fileName,
            clientName:     customerName || phone,
            clientPhone:    phone,
            clientDocId:    clientDocId || '',
            visibleToClient: true,
            targetFolderId: driveExternalFolderId || '',
          }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.driveFileId && orgId && clientDocId) {
              updateDoc(doc(db, 'organization_data', orgId, 'clients', clientDocId, 'documents', docRef.id), {
                driveFileId:  d.driveFileId,
                driveFileUrl: d.driveFileUrl,
              }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      setPendingFile(null); setPendingFileName(""); await fetchDocuments();
    } catch (err) {
      setUploadError(err.code==="storage/unauthorized" ? "Upload not allowed — please sign out and back in." : err.message||"Upload failed.");
    } finally { setUploading(false); }
  };

  const handleDelete = async (document) => {
    try {
      if (document.storagePath) await deleteObject(ref(storage, document.storagePath)).catch(() => {});
      if (orgId && clientDocId) {
        await deleteDoc(doc(db,"organization_data",orgId,"clients",clientDocId,"documents",document.id));
      } else {
        await deleteDoc(doc(db,"users",user.uid,"documents",document.id));
      }
      setDocuments(p => p.filter(d => d.id!==document.id));
      await logActivity("document_deleted", `Deleted document: "${document.name}"`);
    } catch (err) { console.error(err); }
  };

  const saveClaimInfo = async (e) => {
    e?.preventDefault(); if (!user) return;
    setSavingInfo(true); setInfoError("");
    try {
      const addressVal = (addressInputRef.current?.value ?? infoEdit.address).trim();
      const adj = { name:adjusterEdit.name.trim()||null, company:adjusterEdit.company.trim()||null, phone:adjusterEdit.phone.trim()||null, email:adjusterEdit.email.trim()||null };
      const payload = { policyNumber:infoEdit.policyNumber.trim()||null, address:addressVal||null, email:infoEdit.email.trim()||null, claimNumbers:infoEdit.claimNumber.trim() ? [infoEdit.claimNumber.trim()] : [], adjuster:adj, updatedAt:serverTimestamp() };
      await setDoc(doc(db,"users",user.uid), payload, { merge:true });
      if (orgId && clientDocId) {
        setDoc(doc(db,"organization_data",orgId,"clients",clientDocId), { policyNumber:payload.policyNumber, address:payload.address, email:payload.email, claimNumbers:payload.claimNumbers, adjuster:adj }, { merge:true }).catch(()=>{});
      }
      const saved = { claimNumber:infoEdit.claimNumber.trim(), policyNumber:infoEdit.policyNumber.trim(), address:addressVal, email:infoEdit.email.trim() };
      const savedAdj = { name:adj.name||"", company:adj.company||"", phone:adj.phone||"", email:adj.email||"" };
      setClaimInfo(saved); setAdjuster(savedAdj); setEditingInfo(false);
      await logActivity("info_updated", "Updated claim information");
    } catch (err) { setInfoError(err.message||"Could not save. Please try again."); }
    finally { setSavingInfo(false); }
  };

  const onLogout = async () => { await signOut(auth); navigate("/myclaim/login"); };

  const visiblePhotos = clientPhotoIds==null ? photos : photos.filter(p => clientPhotoIds.includes(p.id));
  const getPhotoUrls = (photo) => {
    const uris = photo.uris||photo.urls||[];
    const pick = (type) => uris.find(u => u.type===type);
    const thumb = (pick("small")||pick("medium")||pick("large")||uris[0])?.url || (pick("small")||pick("medium")||pick("large")||uris[0])?.uri;
    const original = (pick("original")||pick("large")||uris[0])?.url || (pick("original")||pick("large")||uris[0])?.uri || thumb;
    return { thumb, original };
  };

  const openTodos = todos.filter(t => !t.completed);
  const doneTodos = todos.filter(t => t.completed);

  const renderTodoItem = (t) => {
    const isDone = t.completed;
    const info = TODO_TYPE_INFO[t.type] || TODO_TYPE_INFO.upload_file;
    const TIcon = info.Icon;
    return (
      <div key={t.id} className={`cp-todo${isDone?" done":""}`} onClick={() => toggleTodo(t)}>
        <div className="cp-todo-circle">{isDone && <CheckIcon size={12} />}</div>
        <div className="cp-todo-icon"><TIcon /></div>
        <div className="cp-todo-body">
          <span className="cp-todo-label">{t.label||t.text||info.label}</span>
          {t.type==="upload_file"      && !isDone && <span className="cp-todo-hint">Tap Upload to add a document</span>}
          {t.type==="sign_forms"       && t.docusignUrl && !isDone && <span className="cp-todo-hint">Tap Sign to sign the document</span>}
          {t.type==="add_selection"    && t.selectionCategory && !isDone && <span className="cp-todo-hint">Category: {t.selectionCategory}</span>}
          {t.type==="review_selection" && !isDone && <span className="cp-todo-hint">Tap Review to approve or reject</span>}
        </div>
        {t.type==="sign_forms" && t.docusignUrl && !isDone && <button className="cp-todo-cta cp-sign-cta" onClick={e=>{ e.stopPropagation(); setSigningTodo(t); }}>Sign →</button>}
        {t.type==="sign_forms" && isDone && t.signedDocumentUrl && <a href={t.signedDocumentUrl} target="_blank" rel="noreferrer" className="cp-todo-cta" onClick={e=>e.stopPropagation()}>View Signed →</a>}
        {t.type==="upload_file"      && !isDone && <button className="cp-todo-cta" onClick={e=>{ e.stopPropagation(); openSidebar(); }}>Upload →</button>}
        {t.type==="add_selection"    && !isDone && <button className="cp-todo-cta" onClick={e=>{ e.stopPropagation(); setSwapTargetId(null); setPickTodoId(t.id); setSelCategory(t.selectionCategory||SELECTION_CATEGORIES[0]); setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelError(""); setShowAddSel(true); }}>Pick →</button>}
        {t.type==="review_selection" && !isDone && <button className="cp-todo-cta" onClick={e=>{ e.stopPropagation(); const sel=selections.find(s=>s.id===t.linkedSelectionId); if (sel) { setReviewingSel(sel); setApproveUrl(sel.url||""); setApproveNotes(sel.notes||""); } }}>Review →</button>}
        {isDone && <span className="cp-todo-done-tag">Done</span>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="cp-root">

      {/* ── Header ── */}
      <header className="cp-header">
        <div className="cp-logo">
          <span className="cp-logo-myclaim">MyClaim</span>
          {(orgInfo?.companyName || orgInfo?.domain) && (
            <>
              <span className="cp-logo-sep">·</span>
              <span className="cp-logo-company">{orgInfo.companyName || orgInfo.domain}</span>
            </>
          )}
        </div>
        <div className="cp-header-center">
          {customerName ? <>Welcome, <strong>{customerName}</strong></> : "Client Portal"}
        </div>
        <div className="cp-header-right">
          <button className="cp-btn" onClick={openSidebar}>
            <DocIcon /> <span>Documents</span>
          </button>
          <button className="cp-btn cp-btn--ghost" onClick={onLogout}>Log Out</button>
        </div>
      </header>

      {/* ── Scrollable page ── */}
      <div className="cp-page">

        {/* Welcome banner */}
        <div className="cp-welcome">
          <div className="cp-welcome-left">
            <div className="cp-welcome-row">
              <span className="cp-welcome-eyebrow">{orgInfo?.companyName || "Ukrainian Restoration"} — Client Information</span>
            </div>
            <div className="cp-welcome-row">
              {claimInfo.address && <span className="cp-welcome-meta-item"><HomeIcon />{claimInfo.address}</span>}
              {claimInfo.address && (claimInfo.email || phone) && <span className="cp-welcome-sep">·</span>}
              {claimInfo.email   && <span className="cp-welcome-meta-item"><EmailIcon size={11} />{claimInfo.email}</span>}
              {claimInfo.email   && phone && <span className="cp-welcome-sep">·</span>}
              {phone             && <span className="cp-welcome-meta-item"><PhoneIcon size={11} />{formatPhone(phone)}</span>}
              {todos.length > 0  && <><span className="cp-welcome-sep">·</span><span className="cp-welcome-meta-item"><CheckIcon size={11} />{doneTodos.length}/{todos.length} tasks</span></>}
            </div>
          </div>
          <div className="cp-welcome-right">
            <span className="cp-claim-panel-title">Claim Information</span>
            <div className="cp-welcome-row">
              <span className="cp-claim-chip"><span className="cp-claim-chip-label">Claim #</span>{claimInfo.claimNumber || "—"}</span>
              <span className="cp-claim-chip"><span className="cp-claim-chip-label">Policy #</span>{claimInfo.policyNumber || "—"}</span>
              <span className="cp-claim-chip"><span className="cp-claim-chip-label">Adjuster</span>{adjuster.name || "—"}</span>
              <span className="cp-claim-chip"><span className="cp-claim-chip-label">Ins. Co.</span>{adjuster.company || "—"}</span>
              <button className="cp-welcome-edit-btn" onClick={() => { setInfoEdit({...claimInfo}); setAdjusterEdit({...adjuster}); setEditingInfo(true); setInfoError(""); }}>
                <EditIcon /> Edit
              </button>
            </div>
          </div>
        </div>

        {/* ── Progress ── */}
        {(portalSections.mitigationProgress||portalSections.constructionProgress) && (
          <div className="cp-progress-row">
            {portalSections.mitigationProgress && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">Mitigation Progress</h2>
                  <span className="cp-card-badge"><LockIcon /> Contractor managed</span>
                </div>
                <div className="cp-tracker-body">
                  <ProgressTracker steps={MITIGATION_STEPS} currentStep={claimProgress.mitigationStep} />
                </div>
              </div>
            )}
            {portalSections.constructionProgress && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">Construction Progress</h2>
                  <span className="cp-card-badge"><LockIcon /> Contractor managed</span>
                </div>
                <div className="cp-tracker-body">
                  <ProgressTracker steps={CONSTRUCTION_STEPS} currentStep={claimProgress.constructionStep} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 2-column layout ── */}
        <div className="cp-layout">

          {/* Left column */}
          <div className="cp-col">

            {/* Action Items */}
            {portalSections.todos && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">
                    Action Items
                    {todos.length > 0 && <span className="cp-count-badge">{doneTodos.length}/{todos.length}</span>}
                  </h2>
                </div>
                {todos.length === 0
                  ? <p className="cp-todo-empty">No action items yet.</p>
                  : <>
                      {openTodos.length === 0
                        ? <p className="cp-todo-empty">All done — great work!</p>
                        : openTodos.map(renderTodoItem)}
                      {doneTodos.length > 0 && (
                        <>
                          <button className="cp-done-toggle" onClick={() => setShowDoneTodos(v=>!v)}>
                            <ChevronIcon className={`cp-chevron${showDoneTodos?" open":""}`} />
                            {doneTodos.length} completed item{doneTodos.length!==1?"s":""}
                          </button>
                          <div className={`cp-done-list${showDoneTodos?" open":""}`}>{doneTodos.map(renderTodoItem)}</div>
                        </>
                      )}
                    </>
                }
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="cp-col">

            {/* Contractor */}
            <div className="cp-card">
              <div className="cp-card-head">
                <h2 className="cp-card-title">Your Project Team</h2>
              </div>
              {orgInfo ? (
                <div className="cp-contractor">
                  <div className="cp-contractor-top">
                    <div className="cp-contractor-avatar">
                      {(orgInfo.companyName||orgInfo.domain||"U")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="cp-contractor-company">{orgInfo.companyName||orgInfo.domain}</p>
                      <p className="cp-contractor-sub">Your restoration contractor</p>
                    </div>
                  </div>
                  <hr className="cp-contractor-divider" />
                  <div className="cp-contractor-links">
                    {orgInfo.companyPhone && (
                      <a href={`tel:${orgInfo.companyPhone}`} className="cp-contractor-link">
                        <span className="cp-contractor-link-icon"><PhoneIcon size={14} /></span>
                        {formatPhone(orgInfo.companyPhone)}
                      </a>
                    )}
                    {orgInfo.companyAddress && (
                      <span className="cp-contractor-link">
                        <span className="cp-contractor-link-icon"><MapPinIcon size={13} /></span>
                        {orgInfo.companyAddress}
                      </span>
                    )}
                  </div>
                  {contractors.length > 0 && (
                    <>
                      <hr className="cp-contractor-divider" />
                      <p className="cp-team-label">Team</p>
                      <div className="cp-contractor-links">
                        {contractors.map(c => {
                          // Prefer profile fields saved in Settings over auth defaults
                          const displayName  = c.displayName || c.email || "Team Member";
                          const shownEmail   = c.contactEmail || c.email || null;
                          const shownPhone   = c.phone || null;
                          const roleLabel    = c.role === "project_manager" ? "Project Manager" : c.role === "public_adjuster" ? "Public Adjuster" : "Admin";
                          return (
                            <div key={c.uid} className="cp-team-member">
                              <div className="cp-team-avatar">
                                {displayName[0].toUpperCase()}
                              </div>
                              <div className="cp-team-info">
                                <span className="cp-team-name">
                                  {displayName}
                                  <span className="cp-team-role">{roleLabel}</span>
                                </span>
                                {shownEmail && (
                                  <a href={`mailto:${shownEmail}`} className="cp-team-email">
                                    <EmailIcon size={11} /> {shownEmail}
                                  </a>
                                )}
                                {shownPhone && (
                                  <a href={`tel:${shownPhone}`} className="cp-team-email">
                                    <PhoneIcon size={11} /> {formatPhone(shownPhone)}
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="cp-contractor">
                  <div className="cp-contractor-top">
                    <div className="cp-contractor-avatar" style={{background:"#f1f5f9"}} />
                    <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
                      <span className="cp-skel" style={{width:"60%",height:14}} />
                      <span className="cp-skel" style={{width:"40%",height:10}} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Selections */}
            {portalSections.selections && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">Client Selections</h2>
                  <button className="cp-btn cp-btn--primary" onClick={() => { setSwapTargetId(null); setPickTodoId(null); setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelCategory(SELECTION_CATEGORIES[0]); setShowAddSel(true); setSelError(""); }}>
                    + Add Selection
                  </button>
                </div>
                {selections.length===0
                  ? <p className="cp-todo-empty">No selections added yet.</p>
                  : Object.entries(selections.reduce((acc,s) => { (acc[s.category]=acc[s.category]||[]).push(s); return acc; },{})).map(([cat,items]) => {
                      const isOpen = openSections.has(cat);
                      return (
                        <div key={cat} className={`cp-sel-group${isOpen?" open":""}`}>
                          <button className="cp-sel-group-btn" onClick={() => setOpenSections(p => { const s=new Set(p); s.has(cat)?s.delete(cat):s.add(cat); return s; })}>
                            <span className="cp-sel-group-name">{cat}</span>
                            <span className="cp-sel-group-count">{items.length} item{items.length!==1?"s":""}</span>
                            <ChevronIcon className={`cp-chevron${isOpen?" open":""}`} />
                          </button>
                          <div className="cp-sel-items">
                            {items.map(s => {
                              const prevData = s.url ? linkPreviews[s.url] : null;
                              const preview  = prevData && prevData!=="loading" && prevData!=="error" ? prevData : null;
                              const isNeedsApproval = s.status==="needs_approval";
                              const isRejected = s.status==="rejected";
                              const isApproved = s.status==="approved";
                              const canEdit = isApproved;
                              const approvedLabel = isApproved ? (s.addedBy==="client" ? "Your pick" : "You approved") : null;
                              const approvedDate  = isApproved ? formatShortDate(s.approvedAt||(s.addedBy==="client"?s.addedAt:null)) : null;
                              const updatedDate   = s.updatedAt ? formatShortDate(s.updatedAt) : null;

                              const nameRow = (
                                <div className="cp-sel-name-row">
                                  <span className="cp-sel-name">{s.product}</span>
                                  {isApproved && <span className="cp-status cp-status-approved">✓ {approvedLabel}{approvedDate?` · ${approvedDate}`:""}</span>}
                                  {isRejected && <span className="cp-status cp-status-rejected">Rejected</span>}
                                  {isNeedsApproval && <span className="cp-status cp-status-pending">Needs Approval</span>}
                                </div>
                              );

                              const itemContent = (
                                <>
                                  {nameRow}
                                  {s.notes && <span className="cp-sel-notes">{s.notes}</span>}
                                  {updatedDate && <span className="cp-sel-updated">Edited {updatedDate}</span>}
                                  {s.url && (prevData==="loading"
                                    ? <div className="cp-sel-preview"><div className="cp-spin cp-spin-sm" /></div>
                                    : preview ? (
                                        <div className="cp-sel-preview">
                                          {preview.brand && <span className="cp-sel-preview-brand">{preview.brand}</span>}
                                          {preview.title && <span className="cp-sel-preview-title">{preview.title}</span>}
                                          {preview.price && <span className="cp-sel-preview-price">{preview.currency==="USD"||!preview.currency?"$":preview.currency+" "}{preview.price}</span>}
                                          {preview.description && <span className="cp-sel-preview-desc">{preview.description}</span>}
                                          <span className="cp-sel-preview-url">{new URL(s.url).hostname} <ExternalLinkIcon /></span>
                                        </div>
                                      ) : <span className="cp-sel-link">View link →</span>
                                  )}
                                  {canEdit && <span className="cp-sel-edit-hint">Tap to edit</span>}
                                </>
                              );

                              return (
                                <div key={s.id}>
                                  {canEdit ? (
                                    <div
                                      className={`cp-sel-item cp-sel-item--editable${isNeedsApproval?" sel-pending":""}${isRejected?" sel-rejected":""}`}
                                      onClick={() => openEditSel(s)}
                                      role="button" tabIndex={0}
                                      onKeyDown={e => e.key==="Enter"&&openEditSel(s)}
                                    >
                                      {itemContent}
                                    </div>
                                  ) : s.url ? (
                                    <a href={s.url} target="_blank" rel="noreferrer" className={`cp-sel-item${isNeedsApproval?" sel-pending":""}${isRejected?" sel-rejected":""}`}>
                                      {itemContent}
                                    </a>
                                  ) : (
                                    <div className={`cp-sel-item${isNeedsApproval?" sel-pending":""}${isRejected?" sel-rejected":""}`}>
                                      {itemContent}
                                    </div>
                                  )}
                                  {isNeedsApproval && (
                                    <div className="cp-sel-approval">
                                      <button className="cp-approval-btn approve" onClick={() => { setReviewingSel(s); setApproveUrl(s.url||""); setApproveNotes(s.notes||""); }}>✓ Review &amp; Approve</button>
                                      <button className="cp-approval-btn reject"  onClick={() => rejectSelection(s)}>✕ Reject</button>
                                      <button className="cp-approval-btn swap"    onClick={() => { setSwapTargetId(s.id); setSelCategory(s.category); setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelError(""); setPickTodoId(null); setShowAddSel(true); }}>↔ Swap</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                }
              </div>
            )}

            {/* Budget */}
            {portalSections.budget && budgetItems.length > 0 && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">Project Budget</h2>
                  <span className="cp-card-badge"><LockIcon /> Contractor managed</span>
                </div>
                {budgetItems.map(b => (
                  <div key={b.id} className="cp-budget-row">
                    <div>
                      <div className="cp-budget-name">{b.label||b.item}</div>
                      {b.description && <div className="cp-budget-desc">{b.description}</div>}
                    </div>
                    <div className="cp-budget-right">
                      {b.priceType!=="set price" && b.quantity!=null
                        ? <div className="cp-budget-qty">{b.quantity.toLocaleString()} {b.priceType}{b.unitPrice!=null && ` × $${b.unitPrice.toFixed(2)}`}</div>
                        : b.priceType==="set price" ? <div className="cp-budget-qty">Set Price</div> : null}
                      {b.total!=null && <div className="cp-budget-amount">{b.total.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2})}</div>}
                    </div>
                  </div>
                ))}
                <div className="cp-budget-total">
                  <span>Total Estimate</span>
                  <span>{budgetItems.reduce((s,b)=>s+(b.total||0),0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2})}</span>
                </div>
              </div>
            )}

            {/* Photos */}
            {companyCamProjectId && portalSections.photos && (
              <div className="cp-card">
                <div className="cp-card-head">
                  <h2 className="cp-card-title">My Photos</h2>
                  {companyCamProjectName && <span className="cp-card-badge">{companyCamProjectName}</span>}
                </div>
                {photosLoading
                  ? <div className="cp-photos-loading"><div className="cp-spin" /></div>
                  : photosError
                    ? <p className="cp-photos-empty" style={{color:"#ef4444"}}>{photosError}</p>
                    : visiblePhotos.length===0
                      ? <p className="cp-photos-empty">No photos yet.</p>
                      : (
                        <>
                          <div className="cp-photos-grid">
                            {visiblePhotos.slice(0, 8).map((photo, idx) => {
                              const {thumb} = getPhotoUrls(photo); if (!thumb) return null;
                              return (
                                <div key={photo.id} className="cp-photo-tile" onClick={() => { setShowPhotoPopup(true); setPhotoLightboxIdx(idx); }}>
                                  <img src={thumb} alt="" loading="lazy" />
                                </div>
                              );
                            })}
                            {visiblePhotos.length > 8 && (
                              <div className="cp-photo-tile cp-photo-more" onClick={() => setShowPhotoPopup(true)}>
                                +{visiblePhotos.length - 8} more
                              </div>
                            )}
                          </div>
                          {visiblePhotos.length > 0 && (
                            <button className="cp-photos-view-all" onClick={() => setShowPhotoPopup(true)}>
                              View all {visiblePhotos.length} photos
                            </button>
                          )}
                        </>
                      )
                }
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Edit Claim Info Modal ── */}
      {editingInfo && (
        <div className="cp-backdrop" onClick={() => { setEditingInfo(false); setInfoError(""); }}>
          <div className="cp-modal cp-modal--wide" onClick={e => e.stopPropagation()}>
            <div className="cp-modal-head">
              <h3 className="cp-modal-title">Edit Claim Information</h3>
              <button className="cp-modal-x" onClick={() => { setEditingInfo(false); setInfoError(""); }}>✕</button>
            </div>
            <div className="cp-modal-body">
              <p className="cp-modal-section-label">Claim Details</p>
              <div className="cp-form-grid">
                <div className="cp-field">
                  <label className="cp-field-label">Claim Number</label>
                  <input className="cp-input" placeholder="e.g. CLM-2024-00123" value={infoEdit.claimNumber} onChange={e => setInfoEdit(v=>({...v,claimNumber:e.target.value}))} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Policy Number</label>
                  <input className="cp-input" placeholder="e.g. POL-987654" value={infoEdit.policyNumber} onChange={e => setInfoEdit(v=>({...v,policyNumber:e.target.value}))} />
                </div>
                <div className="cp-field cp-field--full">
                  <label className="cp-field-label">Home Address</label>
                  <input className="cp-input" placeholder="123 Main St, City, State 12345" ref={addressInputRef} defaultValue={infoEdit.address} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Email</label>
                  <input className="cp-input" type="email" placeholder="you@example.com" value={infoEdit.email} onChange={e => setInfoEdit(v=>({...v,email:e.target.value}))} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Phone <span className="cp-field-muted">(verified)</span></label>
                  <input className="cp-input cp-input--ro" value={formatPhone(phone)} readOnly />
                </div>
              </div>

              <p className="cp-modal-section-label" style={{marginTop:18}}>Insurance Adjuster</p>
              <div className="cp-form-grid">
                <div className="cp-field">
                  <label className="cp-field-label">Adjuster Name</label>
                  <input className="cp-input" placeholder="Jane Smith" value={adjusterEdit.name} onChange={e => setAdjusterEdit(v=>({...v,name:e.target.value}))} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Insurance Company</label>
                  <input className="cp-input" placeholder="State Farm" value={adjusterEdit.company} onChange={e => setAdjusterEdit(v=>({...v,company:e.target.value}))} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Adjuster Phone</label>
                  <input className="cp-input" placeholder="(555) 000-0000" value={adjusterEdit.phone} onChange={e => setAdjusterEdit(v=>({...v,phone:e.target.value}))} />
                </div>
                <div className="cp-field">
                  <label className="cp-field-label">Adjuster Email</label>
                  <input className="cp-input" type="email" placeholder="adjuster@insurance.com" value={adjusterEdit.email} onChange={e => setAdjusterEdit(v=>({...v,email:e.target.value}))} />
                </div>
              </div>

              {infoError && <p className="cp-modal-err">{infoError}</p>}
              <div className="cp-modal-actions">
                <button className="cp-btn" onClick={() => { setEditingInfo(false); setInfoError(""); }}>Cancel</button>
                <button className="cp-btn cp-btn--primary" onClick={saveClaimInfo} disabled={savingInfo}>
                  {savingInfo ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Selection Modal ── */}
      {showAddSel && (
        <div className="cp-backdrop" onClick={() => { setShowAddSel(false); setSwapTargetId(null); setPickTodoId(null); }}>
          <div className="cp-modal" onClick={e => e.stopPropagation()}>
            <div className="cp-modal-head">
              <h3 className="cp-modal-title">{swapTargetId?"Swap Selection":"Add a Selection"}</h3>
              <button className="cp-modal-x" onClick={() => { setShowAddSel(false); setSwapTargetId(null); setPickTodoId(null); }}>✕</button>
            </div>
            <div className="cp-modal-body">
              {swapTargetId && <p className="cp-modal-hint">Your new selection will replace the contractor's suggestion.</p>}
              {pickTodoId && !swapTargetId && <p className="cp-modal-hint">Pick a selection for your contractor's request.</p>}
              <div className="cp-field">
                <label className="cp-field-label">Category</label>
                <select className="cp-input" value={selCategory} onChange={e => setSelCategory(e.target.value)}>
                  {SELECTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Product / Item *</label>
                <input className="cp-input" placeholder="e.g. Shaw Floors Cornerstone Tile" value={selProduct} onChange={e => setSelProduct(e.target.value)} />
              </div>
              <div className="cp-field">
                <label className="cp-field-label">URL <span className="cp-field-muted">(optional)</span></label>
                <input className="cp-input" placeholder="https://..." value={selUrl} onChange={e => setSelUrl(e.target.value)} />
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Notes <span className="cp-field-muted">(optional)</span></label>
                <input className="cp-input" placeholder="Color, size, quantity, etc." value={selNotes} onChange={e => setSelNotes(e.target.value)} />
              </div>
              {selError && <p className="cp-modal-err">{selError}</p>}
              <div className="cp-modal-actions">
                <button className="cp-btn" onClick={() => { setShowAddSel(false); setSwapTargetId(null); setPickTodoId(null); }}>Cancel</button>
                <button className="cp-btn cp-btn--primary" onClick={() => addSelection(swapTargetId, pickTodoId)} disabled={addingSel}>
                  {addingSel?"Saving…":swapTargetId?"Swap Selection":"Add Selection"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve Selection Modal ── */}
      {reviewingSel && (
        <div className="cp-backdrop" onClick={() => setReviewingSel(null)}>
          <div className="cp-modal" onClick={e => e.stopPropagation()}>
            <div className="cp-modal-head">
              <div>
                <h3 className="cp-modal-title">Review Selection</h3>
                <span className="cp-cat-tag">{reviewingSel.category}</span>
              </div>
              <button className="cp-modal-x" onClick={() => setReviewingSel(null)}>✕</button>
            </div>
            <div className="cp-modal-body">
              <div className="cp-approve-name">{reviewingSel.product}</div>
              {reviewingSel.notes && <p className="cp-approve-note"><strong>Contractor note:</strong> {reviewingSel.notes}</p>}
              {approveUrl.trim() && (
                <a href={approveUrl.trim().startsWith("http") ? approveUrl.trim() : `https://${approveUrl.trim()}`} target="_blank" rel="noreferrer" className="cp-approve-link">
                  <span className="cp-approve-link-icon">🔗</span>
                  <div className="cp-approve-link-body">
                    <span className="cp-approve-link-label">View Product</span>
                    <span className="cp-approve-link-host">{(() => { try { return new URL(approveUrl.trim().startsWith("http")?approveUrl.trim():`https://${approveUrl.trim()}`).hostname; } catch { return approveUrl.trim(); } })()}</span>
                  </div>
                  <ExternalLinkIcon />
                </a>
              )}
              <div className="cp-field">
                <label className="cp-field-label">Product URL <span className="cp-field-muted">(optional)</span></label>
                <input className="cp-input" placeholder="https://homedepot.com/..." value={approveUrl} onChange={e => setApproveUrl(e.target.value)} type="url" />
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Notes <span className="cp-field-muted">(color, size, finish…)</span></label>
                <input className="cp-input" placeholder="e.g. Beige, 12×24 tile, matte finish" value={approveNotes} onChange={e => setApproveNotes(e.target.value)} />
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button className="cp-approve-confirm" onClick={() => { approveSelection(reviewingSel,approveUrl,approveNotes); setReviewingSel(null); }}>✓ Approve Selection</button>
                <div className="cp-approve-secondary">
                  <button className="cp-approval-btn reject" onClick={() => { rejectSelection(reviewingSel); setReviewingSel(null); }}>✕ Reject</button>
                  <button className="cp-approval-btn swap"   onClick={() => { const sel=reviewingSel; setReviewingSel(null); setSwapTargetId(sel.id); setSelCategory(sel.category); setSelProduct(""); setSelUrl(""); setSelNotes(""); setSelError(""); setPickTodoId(null); setShowAddSel(true); }}>↔ Swap</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── Edit Selection Modal ── */}
      {editingSel && (
        <div className="cp-backdrop" onClick={() => setEditingSel(null)}>
          <div className="cp-modal" onClick={e => e.stopPropagation()}>
            <div className="cp-modal-head">
              <div>
                <h3 className="cp-modal-title">Edit Selection</h3>
                <span className="cp-cat-tag">{editingSel.category}</span>
              </div>
              <button className="cp-modal-x" onClick={() => setEditingSel(null)}>✕</button>
            </div>
            <div className="cp-modal-body">
              <div className="cp-field">
                <label className="cp-field-label">Category</label>
                <select className="cp-input" value={editSelCategory} onChange={e => setEditSelCategory(e.target.value)}>
                  {SELECTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Product / Item name</label>
                <input className="cp-input" value={editSelProduct} onChange={e => setEditSelProduct(e.target.value)} placeholder="e.g. Moen Arbor Faucet" autoFocus />
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Product URL <span className="cp-field-muted">(optional)</span></label>
                <input className="cp-input" type="url" value={editSelUrl} onChange={e => setEditSelUrl(e.target.value)} placeholder="https://homedepot.com/..." />
              </div>
              <div className="cp-field">
                <label className="cp-field-label">Notes <span className="cp-field-muted">(color, size, finish…)</span></label>
                <input className="cp-input" value={editSelNotes} onChange={e => setEditSelNotes(e.target.value)} placeholder="e.g. Brushed nickel, 12×24 tile, matte" />
              </div>
              {editSelError && <p className="cp-sel-err">{editSelError}</p>}
              <div className="cp-modal-actions">
                <button className="cp-btn" onClick={() => setEditingSel(null)}>Cancel</button>
                <button className="cp-btn cp-btn--primary" onClick={saveEditSel} disabled={savingEditSel || !editSelProduct.trim()}>
                  {savingEditSel ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Document Sidebar ── */}
      {sidebarOpen && <div className="cp-dim" onClick={() => setSidebarOpen(false)} />}
      <aside className={`cp-sidebar${sidebarOpen?" open":""}`}>
        <div className="cp-sidebar-head">
          <h2>Documents</h2>
          <button className="cp-sidebar-x" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        {pendingFile ? (
          <div className="cp-upload-stage">
            <div className="cp-upload-file-row"><UploadIcon /><span className="cp-upload-fn">{pendingFile.name}</span></div>
            <label className="cp-upload-lbl">Name <span style={{fontWeight:400,color:"#94a3b8"}}>(optional)</span></label>
            <input className="cp-upload-input" type="text" value={pendingFileName} onChange={e => setPendingFileName(e.target.value)} placeholder="e.g. Water Damage Photos" autoFocus />
            {uploadError && <p className="cp-upload-err">{uploadError}</p>}
            <div className="cp-upload-actions">
              <button className="cp-btn" onClick={() => { setPendingFile(null); setPendingFileName(""); setUploadError(""); }} disabled={uploading}>Cancel</button>
              <button className="cp-btn cp-btn--primary" onClick={confirmUpload} disabled={uploading}>
                {uploading ? <><div className="cp-spin cp-spin-sm" /> Uploading…</> : "Upload"}
              </button>
            </div>
          </div>
        ) : (
          <div className={`cp-drop${uploading?" uploading":""}`} onClick={() => !uploading && fileInputRef.current?.click()}>
            {uploading ? <div className="cp-spin" /> : <UploadIcon />}
            <span>{uploading ? "Uploading…" : "Click to upload a file"}</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={handleUpload} disabled={uploading} />
        <p className="cp-doc-heading">My Insurance Documents</p>
        <div className="cp-doc-list">
          {docError ? (
            <div className="cp-doc-err"><p>{docError}</p><button className="cp-doc-retry" onClick={fetchDocuments}>Retry</button></div>
          ) : documents.filter(d => d.folder !== "internal").length===0 ? (
            <p className="cp-doc-empty">No documents uploaded yet.</p>
          ) : documents.filter(d => d.folder !== "internal").map(d => {
            const type = fileType(d.name);
            return (
              <div key={d.id} className="cp-doc-item">
                {type==="image"
                  ? <img src={d.downloadURL} alt={d.name} className="cp-doc-thumb" onClick={() => setPreview({name:d.name,url:d.downloadURL})} />
                  : <div className="cp-doc-icon"><FileTypeIcon type={type} /></div>}
                <div className="cp-doc-info">
                  <span className="cp-doc-name" title={d.name}>{d.name}</span>
                  {d.size && <span className="cp-doc-size">{formatBytes(d.size)}</span>}
                  <div className="cp-doc-acts">
                    <button className="cp-doc-act" onClick={() => type==="image" ? setPreview({name:d.name,url:d.downloadURL}) : window.open(d.downloadURL,"_blank")}>{type==="image"?"Preview":"Open"}</button>
                    <a className="cp-doc-act" href={d.downloadURL} download={d.name} target="_blank" rel="noreferrer">Download</a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Photo popup grid ── */}
      {showPhotoPopup && visiblePhotos.length > 0 && (
        <div className="cp-backdrop" onClick={() => { setShowPhotoPopup(false); setPhotoLightboxIdx(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12,
            width: 700, maxWidth: '95vw', maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
              <span style={{ fontWeight:700, fontSize:15, color:'#1e293b', flex:1 }}>My Photos</span>
              <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', padding:'3px 10px', borderRadius:20 }}>
                {visiblePhotos.length} photos
              </span>
              <button className="cp-modal-x" onClick={() => { setShowPhotoPopup(false); setPhotoLightboxIdx(null); }}>✕</button>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, padding:16, overflowY:'auto', alignContent:'flex-start' }}>
              {visiblePhotos.map((photo, idx) => {
                const {thumb} = getPhotoUrls(photo); if (!thumb) return null;
                return (
                  <div key={photo.id} onClick={() => setPhotoLightboxIdx(idx)}
                    style={{ width:150, height:150, flexShrink:0, borderRadius:6, overflow:'hidden', cursor:'pointer', position:'relative' }}>
                    <img src={thumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Photo lightbox (opens from within popup) ── */}
      {photoLightboxIdx !== null && visiblePhotos.length > 0 && (() => {
        const idx = photoLightboxIdx;
        const photo = visiblePhotos[idx];
        const {original} = getPhotoUrls(photo);
        const close = () => setPhotoLightboxIdx(null);
        const prev  = () => setPhotoLightboxIdx((idx - 1 + visiblePhotos.length) % visiblePhotos.length);
        const next  = () => setPhotoLightboxIdx((idx + 1) % visiblePhotos.length);
        return (
          <div className="cp-lightbox" onClick={close}
            onTouchStart={e => { photoTouchX.current = e.touches[0].clientX; }}
            onTouchEnd={e => { if (photoTouchX.current === null) return; const dx = e.changedTouches[0].clientX - photoTouchX.current; photoTouchX.current = null; if (Math.abs(dx) < 40) return; dx < 0 ? next() : prev(); }}
          >
            <div className="cp-lightbox-bar" onClick={e => e.stopPropagation()}>
              <span className="cp-lightbox-counter">{idx + 1} / {visiblePhotos.length}</span>
              <button className="cp-lightbox-close" onClick={close}>✕</button>
            </div>
            {visiblePhotos.length > 1 && <button className="cp-lightbox-nav cp-lightbox-prev" onClick={e => { e.stopPropagation(); prev(); }}>‹</button>}
            {visiblePhotos.length > 1 && <button className="cp-lightbox-nav cp-lightbox-next" onClick={e => { e.stopPropagation(); next(); }}>›</button>}
            <img key={idx} src={original} alt="" className="cp-lightbox-img" onClick={e => e.stopPropagation()} />
          </div>
        );
      })()}

      {/* ── Image preview ── */}
      {preview && (
        <div className="cp-preview-overlay" onClick={() => setPreview(null)}>
          <div className="cp-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="cp-preview-head">
              <span>{preview.name}</span>
              <button className="cp-preview-close" onClick={() => setPreview(null)}>✕</button>
            </div>
            <img src={preview.url} alt={preview.name} className="cp-preview-img" />
          </div>
        </div>
      )}

      {/* ── Signing modal ──────────────────────────────────────────────────── */}
      {signingTodo && (
        <SigningModal
          todo={signingTodo}
          user={user}
          onSigned={markSigned}
          onClose={() => setSigningTodo(null)}
        />
      )}
    </div>
  );
}


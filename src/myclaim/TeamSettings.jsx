import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, orderBy, where, addDoc, serverTimestamp, updateDoc, writeBatch,
} from "firebase/firestore";
import { useAuth } from "./useAuth";
import { api } from "./api";
import TemplateBuilder from "./TemplateBuilder";
import "./TeamSettings.css";

const ROLES = [
  { value: "admin",            label: "Admin" },
  { value: "project_manager",  label: "Project Manager" },
  { value: "public_adjuster",  label: "Public Adjuster" },
];

const encodeEmail = (email) =>
  email.toLowerCase().replace(/\./g, "__dot__").replace(/@/g, "__at__");

const DEFAULT_INSURERS = [
  'AAA Insurance', 'Acuity Insurance', 'Allstate Insurance', 'American Family Insurance',
  'American National Insurance', 'Amica Mutual Insurance', 'Arbella Insurance',
  'Auto Club Group (AAA)', 'Auto-Owners Insurance', 'Bristol West Insurance',
  'Chubb Insurance', 'Church Mutual Insurance', 'Cincinnati Insurance',
  'Citizens Property Insurance', 'CNA Financial', 'Country Financial',
  'Donegal Insurance Group', 'Encompass Insurance', 'Erie Insurance',
  'Farmers Insurance', 'GEICO Homeowners', 'Grange Insurance',
  'GuideOne Insurance', 'Hanover Insurance Group', 'Hartford Financial Services',
  'Heritage Insurance Holdings', 'Hippo Insurance', 'Homeowners of America',
  'ICW Group', 'Kemper Insurance', 'Kentucky Farm Bureau', 'Kin Insurance',
  'Lemonade Insurance', 'Liberty Mutual Insurance', 'Mercury Insurance',
  'MetLife Home', 'Nationwide Insurance', 'PEMCO Insurance',
  'Progressive Homeowners', 'Safeco Insurance', 'Security First Financial',
  'Sentry Insurance', 'Shelter Insurance', 'Society Insurance',
  'State Farm Insurance', 'Travelers Insurance', 'Universal Property & Casualty',
  'USAA Insurance', 'Westfield Insurance', 'Zurich Insurance',
].sort();

export default function TeamSettings() {
  const { user, orgId: authOrgId, isAdmin } = useAuth();

  const [orgId,        setOrgId]        = useState(null);
  const [userRole,     setUserRole]     = useState(null);
  const [members,      setMembers]      = useState([]);
  const [invites,      setInvites]      = useState([]);
  const [clients,      setClients]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [savingId,     setSavingId]     = useState(null);
  const [removingId,   setRemovingId]   = useState(null);
  const [cancelingId,  setCancelingId]  = useState(null);

  const [assignModal,  setAssignModal]  = useState(null);
  const [assignDraft,  setAssignDraft]  = useState([]);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  // Invite state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail,     setInviteEmail]     = useState('');
  const [inviteRole,      setInviteRole]      = useState('project_manager');
  const [inviting,        setInviting]        = useState(false);
  const [inviteError,     setInviteError]     = useState('');

  // Templates
  const [templates,        setTemplates]        = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTplBuilder,   setShowTplBuilder]   = useState(false);
  const [editingTemplate,  setEditingTemplate]  = useState(null);
  const [builderFile,      setBuilderFile]      = useState(null);
  const [deletingTplId,    setDeletingTplId]    = useState(null);
  const tplFileRef = React.useRef(null);

  // Partners
  const [partners,         setPartners]         = useState([]);
  const [newPartnerName,   setNewPartnerName]   = useState('');
  const [addingPartner,    setAddingPartner]    = useState(false);
  const [removingPartnerId,setRemovingPartnerId]= useState(null);

  // Insurers
  const [insurers,          setInsurers]          = useState([]);
  const [newInsurerName,    setNewInsurerName]    = useState('');
  const [addingInsurer,     setAddingInsurer]     = useState(false);
  const [removingInsurerId, setRemovingInsurerId] = useState(null);

  // Data cleanup
  const [cleanupName,    setCleanupName]    = useState('');
  const [cleanupResults, setCleanupResults] = useState(null); // null | { count, docs }
  const [cleanupSearching, setCleanupSearching] = useState(false);
  const [cleanupDeleting,  setCleanupDeleting]  = useState(false);
  const [cleanupDone,      setCleanupDone]      = useState(false);

  // Orphan scan
  const [orphanScanning,  setOrphanScanning]  = useState(false);
  const [orphanResults,   setOrphanResults]   = useState(null); // null | { count, docs: [{ref,id,clientName}] }
  const [orphanDeleting,  setOrphanDeleting]  = useState(false);
  const [orphanDone,      setOrphanDone]      = useState(false);

  // Integrations
  const [driveStatus,   setDriveStatus]   = useState(null);
  const [driveLoading,  setDriveLoading]  = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [ccApiKey,      setCcApiKey]      = useState('');
  const [ccApiInput,    setCcApiInput]    = useState('');
  const [ccEditing,     setCcEditing]     = useState(false);
  const [ccSaving,      setCcSaving]      = useState(false);
  const [ccLoading,     setCcLoading]     = useState(true);
  const [ccMessage,     setCcMessage]     = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const oid = userSnap.data()?.organizationId || user.uid;
        if (cancelled) return;
        setOrgId(oid);

        const [contractorSnap, membersSnap, clientsSnap, orgSnap, invitesSnap, driveStatusRes] = await Promise.all([
          getDoc(doc(db, "organization_data", oid, "contractors", user.uid)),
          getDocs(query(
            collection(db, "organization_data", oid, "contractors"),
            orderBy("lastLogin", "desc")
          )),
          // Load from org clients subcollection — has richer data (claimStatus, claimNumbers, address)
          getDocs(collection(db, "organization_data", oid, "clients")),
          getDoc(doc(db, "organization_data", oid)),
          getDocs(query(
            collection(db, "organization_data", oid, "invites"),
            orderBy("invitedAt", "desc")
          )).catch(() => ({ docs: [] })),
          api.drive.status(oid).catch(() => ({ connected: false })),
        ]);
        if (cancelled) return;

        const role = contractorSnap.data()?.role || "admin";
        setUserRole(role);

        // Load partners
        const partnerSnap = await getDocs(query(collection(db, 'organization_data', oid, 'partners'), orderBy('name', 'asc'))).catch(() => ({ docs: [] }));
        setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Load insurers — seed defaults on first use
        const insurerSnap = await getDocs(query(collection(db, 'organization_data', oid, 'insurers'), orderBy('name', 'asc'))).catch(() => ({ docs: [] }));
        let insurerList = insurerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (insurerList.length === 0) {
          const batch = writeBatch(db);
          DEFAULT_INSURERS.forEach(name => {
            const ref = doc(collection(db, 'organization_data', oid, 'insurers'));
            batch.set(ref, { name, createdAt: serverTimestamp() });
            insurerList.push({ id: ref.id, name });
          });
          batch.commit().catch(e => console.warn('insurer seed:', e));
        }
        setInsurers(insurerList);

        setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        const cl = clientsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(c => c.phone) // must have a phone to be assignable
          .sort((a, b) => (a.name || a.phone || "").localeCompare(b.name || b.phone || ""));
        setClients(cl);
        setCcApiKey(orgSnap.data()?.companyCamAPI || '');
        setInvites(invitesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setDriveStatus(driveStatusRes);
      } finally {
        if (!cancelled) { setLoading(false); setCcLoading(false); setDriveLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!orgId) return;
    setTemplatesLoading(true);
    getDocs(collection(db, "organization_data", orgId, "signTemplates"))
      .then(snap => setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, [orgId]);

  const orgDomain = user?.email?.split('@')[1];
  const isExternal = (email) => email.trim().split('@')[1] !== orgDomain;

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('Enter a valid email address.');
      return;
    }
    if (members.some(m => m.email === email)) {
      setInviteError('This person is already a team member.');
      return;
    }
    if (invites.some(i => i.email === email)) {
      setInviteError('A pending invite already exists for this email.');
      return;
    }
    setInviting(true);
    setInviteError('');
    try {
      const external = isExternal(email);
      const inviteRef = await addDoc(
        collection(db, "organization_data", orgId, "invites"),
        {
          email,
          role: inviteRole,
          isExternal: external,
          invitedAt: serverTimestamp(),
          invitedBy: user.uid,
        }
      );
      await setDoc(doc(db, "user_invites", encodeEmail(email)), {
        orgId,
        role: inviteRole,
        isExternal: external,
        invitedAt: serverTimestamp(),
      });
      setInvites(prev => [{ id: inviteRef.id, email, role: inviteRole, isExternal: external }, ...prev]);
      closeInviteModal();
    } catch {
      setInviteError('Failed to send invite. Please try again.');
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (invite) => {
    setCancelingId(invite.id);
    try {
      await deleteDoc(doc(db, "organization_data", orgId, "invites", invite.id));
      await deleteDoc(doc(db, "user_invites", encodeEmail(invite.email))).catch(() => {});
      setInvites(prev => prev.filter(i => i.id !== invite.id));
    } finally {
      setCancelingId(null);
    }
  };

  const updateRole = async (member, newRole) => {
    setSavingId(member.id);
    try {
      const ref = doc(db, "organization_data", orgId, "contractors", member.id);
      const update = { role: newRole };
      if (newRole === "admin") update.assignedClients = [];
      await setDoc(ref, update, { merge: true });
      setMembers(prev => prev.map(m =>
        m.id === member.id
          ? { ...m, role: newRole, ...(newRole === "admin" ? { assignedClients: [] } : {}) }
          : m
      ));
    } finally {
      setSavingId(null);
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.displayName || member.email} from the team? They will lose access on next refresh.`)) return;
    setRemovingId(member.id);
    try {
      await deleteDoc(doc(db, "organization_data", orgId, "contractors", member.id));
      // Clear their org mapping so they land on the pending screen on next session
      await setDoc(doc(db, "users", member.id), { organizationId: null, pending: true }, { merge: true }).catch(() => {});
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } finally {
      setRemovingId(null);
    }
  };

  const openAssignModal = (member) => {
    setAssignDraft(member.assignedClients || []);
    setAssignSearch("");
    setAssignModal(member);
  };

  const toggleAssign = (phone) => {
    setAssignDraft(prev =>
      prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]
    );
  };

  const saveAssignments = async () => {
    if (!assignModal) return;
    setAssignSaving(true);
    try {
      const ref = doc(db, "organization_data", orgId, "contractors", assignModal.id);
      await setDoc(ref, { assignedClients: assignDraft }, { merge: true });
      setMembers(prev => prev.map(m =>
        m.id === assignModal.id ? { ...m, assignedClients: assignDraft } : m
      ));
      setAssignModal(null);
    } finally {
      setAssignSaving(false);
    }
  };

  async function handleDriveConnect() {
    if (!orgId) { console.warn('[Drive] orgId not loaded yet'); return; }
    const backendUrl = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5001' : '/api/backend');
    const authUrl = `${backendUrl}/integrations/google-drive/auth?orgId=${orgId}`;
    console.log('[Drive] Opening popup:', authUrl);
    window.open(authUrl, 'google-drive-auth', 'width=520,height=640,left=200,top=100');
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 80) {
        console.warn('[Drive] Polling timed out after 2 min');
        clearInterval(interval);
        return;
      }
      try {
        const status = await api.drive.status(orgId);
        console.log(`[Drive] Poll #${attempts} orgId=${orgId}:`, status);
        if (status?.connected) {
          console.log('[Drive] Connected! Updating UI.');
          clearInterval(interval);
          setDriveStatus(status);
        }
      } catch (err) {
        console.error('[Drive] Poll error:', err);
      }
    }, 1500);
  }

  async function handleDriveDisconnect() {
    setDisconnecting(true);
    await api.drive.disconnect({ orgId }).catch(() => {});
    setDriveStatus({ connected: false });
    setDisconnecting(false);
  }

  async function handleSaveCcKey(e) {
    e.preventDefault();
    if (!orgId) return;
    setCcSaving(true); setCcMessage('');
    try {
      await setDoc(doc(db, 'organization_data', orgId), { companyCamAPI: ccApiInput.trim() }, { merge: true });
      setCcApiKey(ccApiInput.trim());
      setCcEditing(false);
      setCcMessage('API key saved successfully.');
    } catch {
      setCcMessage('Failed to save. Please try again.');
    } finally {
      setCcSaving(false);
    }
  }

  async function handleRemoveCcKey() {
    if (!orgId) return;
    setCcSaving(true);
    try {
      await setDoc(doc(db, 'organization_data', orgId), { companyCamAPI: '' }, { merge: true });
      setCcApiKey(''); setCcEditing(false); setCcMessage('');
    } catch {
      setCcMessage('Failed to remove. Please try again.');
    } finally {
      setCcSaving(false);
    }
  }

  async function addPartner() {
    const name = newPartnerName.trim();
    if (!name || !orgId) return;
    setAddingPartner(true);
    try {
      const ref = await addDoc(collection(db, 'organization_data', orgId, 'partners'), { name, createdAt: serverTimestamp() });
      setPartners(prev => [...prev, { id: ref.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewPartnerName('');
    } finally { setAddingPartner(false); }
  }

  async function removePartner(pid) {
    setRemovingPartnerId(pid);
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'partners', pid));
      setPartners(prev => prev.filter(p => p.id !== pid));
    } finally { setRemovingPartnerId(null); }
  }

  async function addInsurer() {
    const name = newInsurerName.trim();
    if (!name || !orgId) return;
    setAddingInsurer(true);
    try {
      const ref = await addDoc(collection(db, 'organization_data', orgId, 'insurers'), { name, createdAt: serverTimestamp() });
      setInsurers(prev => [...prev, { id: ref.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewInsurerName('');
    } finally { setAddingInsurer(false); }
  }

  async function removeInsurer(iid) {
    setRemovingInsurerId(iid);
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'insurers', iid));
      setInsurers(prev => prev.filter(i => i.id !== iid));
    } finally { setRemovingInsurerId(null); }
  }

  const formatDate = (ts) => {
    if (!ts) return "Never";
    const d = ts.toDate?.() ?? new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const deleteTemplate = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return;
    setDeletingTplId(tpl.id);
    try {
      await deleteDoc(doc(db, "organization_data", orgId, "signTemplates", tpl.id));
      setTemplates(prev => prev.filter(t => t.id !== tpl.id));
    } finally {
      setDeletingTplId(null);
    }
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteRole('project_manager');
    setInviteError('');
  };

  // Gate on both the fast auth-level role and the loaded role (belt-and-suspenders)
  const isBlocked = (userRole && userRole !== "admin") || (!isAdmin && userRole !== null);
  if (isBlocked) {
    return (
      <div className="ts-root">
        <div className="ts-main">
          <p style={{ color: "#94a3b8", textAlign: "center", paddingTop: 60 }}>
            Team Settings is only available to admins.
          </p>
        </div>
      </div>
    );
  }

  async function searchCleanup() {
    if (!orgId || !cleanupName.trim()) return;
    setCleanupSearching(true);
    setCleanupResults(null);
    setCleanupDone(false);
    try {
      const name = cleanupName.trim();
      const [settSnap, invSnap] = await Promise.all([
        getDocs(query(collection(db, 'organization_data', orgId, 'settlement_summary'), where('clientName', '==', name))),
        getDocs(query(collection(db, 'organization_data', orgId, 'invoice_summary'),    where('clientName', '==', name))),
      ]);
      const docs = [
        ...settSnap.docs.map(d => ({ ref: d.ref, col: 'settlement_summary', id: d.id, data: d.data() })),
        ...invSnap.docs.map(d => ({ ref: d.ref, col: 'invoice_summary',    id: d.id, data: d.data() })),
      ];
      setCleanupResults({ count: docs.length, docs });
    } finally {
      setCleanupSearching(false);
    }
  }

  async function deleteCleanup() {
    if (!cleanupResults?.docs?.length) return;
    setCleanupDeleting(true);
    try {
      // Delete summary docs + the underlying invoice/settlement documents from all paths
      const deletes = [];
      cleanupResults.docs.forEach(d => {
        deletes.push(deleteDoc(d.ref).catch(() => {}));
        if (d.col === 'invoice_summary') {
          const { clientUid, clientDocId: cDocId } = d.data || {};
          if (clientUid) {
            deletes.push(deleteDoc(doc(db, 'users', clientUid, 'invoices', d.id)).catch(() => {}));
          }
          if (cDocId) {
            deletes.push(deleteDoc(doc(db, 'organization_data', orgId, 'clients', cDocId, 'invoices', d.id)).catch(() => {}));
          }
        }
      });
      await Promise.all(deletes);
      setCleanupResults(null);
      setCleanupName('');
      setCleanupDone(true);
    } finally {
      setCleanupDeleting(false);
    }
  }

  async function scanOrphans() {
    if (!orgId) return;
    setOrphanScanning(true);
    setOrphanResults(null);
    setOrphanDone(false);
    try {
      const summarySnap = await getDocs(collection(db, 'organization_data', orgId, 'invoice_summary'));
      const orphans = [];
      await Promise.all(summarySnap.docs.map(async d => {
        const data = d.data();
        const invId = d.id;
        let exists = false;
        const checks = [];
        if (data.clientUid) {
          checks.push(getDoc(doc(db, 'users', data.clientUid, 'invoices', invId)).then(s => { if (s.exists()) exists = true }));
        }
        if (data.clientDocId) {
          checks.push(getDoc(doc(db, 'organization_data', orgId, 'clients', data.clientDocId, 'invoices', invId)).then(s => { if (s.exists()) exists = true }));
        }
        await Promise.all(checks);
        if (!exists) {
          orphans.push({ ref: d.ref, id: invId, clientName: data.clientName || '—', total: data.total || 0, issueDate: data.issueDate || '', clientUid: data.clientUid || null, clientDocId: data.clientDocId || null });
        }
      }));
      orphans.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''));
      setOrphanResults({ count: orphans.length, docs: orphans });
    } finally {
      setOrphanScanning(false);
    }
  }

  async function deleteOrphans() {
    if (!orphanResults?.docs?.length) return;
    setOrphanDeleting(true);
    try {
      const deletes = [];
      orphanResults.docs.forEach(d => {
        deletes.push(deleteDoc(d.ref).catch(() => {}));
        if (d.clientUid) {
          deletes.push(deleteDoc(doc(db, 'users', d.clientUid, 'invoices', d.id)).catch(() => {}));
        }
        if (d.clientDocId) {
          deletes.push(deleteDoc(doc(db, 'organization_data', orgId, 'clients', d.clientDocId, 'invoices', d.id)).catch(() => {}));
        }
      });
      await Promise.all(deletes);
      setOrphanResults(null);
      setOrphanDone(true);
    } finally {
      setOrphanDeleting(false);
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  return (
    <div className="ts-root">
      <div className="ts-main">
        <div className="ts-page-header">
          <div>
            <h1 className="ts-title">Team Settings</h1>
            <p className="ts-subtitle">Manage your organization's members and permissions</p>
          </div>
        </div>

        {loading ? (
          <div className="ts-loading"><div className="ts-spinner" /></div>
        ) : (
          <div className="ts-section">
            <div className="ts-section-header">
              <div className="ts-section-header-row">
                <div>
                  <h2 className="ts-section-title">
                    <TeamIcon /> Team Members
                    <span className="ts-member-count">{members.length + invites.length}</span>
                  </h2>
                  <p className="ts-section-hint">Active members and pending invites.</p>
                </div>
                <button className="ts-invite-btn" onClick={() => setShowInviteModal(true)}>
                  <PlusIcon /> Invite Member
                </button>
              </div>
            </div>

            <div className="ts-member-list">
              {/* Active members */}
              {members.map(member => {
                const isYou      = member.id === user?.uid;
                const role       = member.role || "admin";
                const isSaving   = savingId   === member.id;
                const isRemoving = removingId === member.id;
                const assignedCount = (member.assignedClients || []).length;

                return (
                  <div key={member.id} className={`ts-member-card${isYou ? " ts-member-you" : ""}`}>
                    <div className="ts-member-avatar">
                      {(member.displayName || member.email || "?").charAt(0).toUpperCase()}
                    </div>

                    <div className="ts-member-info">
                      <div className="ts-member-name">
                        {member.displayName || <span className="ts-muted">No name</span>}
                        {isYou && <span className="ts-you-badge">You</span>}
                      </div>
                      <div className="ts-member-email">{member.email || "—"}</div>
                      <div className="ts-member-meta">
                        Last login: {formatDate(member.lastLogin)}
                        {(role === "project_manager" || role === "public_adjuster") && (
                          <span className="ts-assigned-hint">
                            &nbsp;· {assignedCount} client{assignedCount !== 1 ? "s" : ""} assigned
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="ts-member-actions">
                      <select
                        className={`ts-role-select ts-role-${role}`}
                        value={role}
                        disabled={isYou || isSaving}
                        onChange={e => updateRole(member, e.target.value)}
                      >
                        {ROLES.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>

                      {(role === "project_manager" || role === "public_adjuster") && !isYou && (
                        <button
                          className="ts-assign-btn"
                          onClick={() => openAssignModal(member)}
                          disabled={isSaving}
                        >
                          <ClientsIcon /> Manage Clients
                        </button>
                      )}

                      {!isYou && (
                        <button
                          className="ts-remove-btn"
                          onClick={() => removeMember(member)}
                          disabled={isRemoving || isSaving}
                          title="Remove from team"
                        >
                          {isRemoving ? <SpinnerInline /> : <TrashIcon />}
                        </button>
                      )}

                      {isSaving && <SpinnerInline />}
                    </div>
                  </div>
                );
              })}

              {/* Pending invites */}
              {invites.map(invite => (
                <div key={invite.id} className="ts-member-card ts-member-invited">
                  <div className="ts-member-avatar ts-avatar-invited">
                    {invite.email.charAt(0).toUpperCase()}
                  </div>

                  <div className="ts-member-info">
                    <div className="ts-member-name">
                      {invite.email}
                      <span className="ts-invited-badge">Invited</span>
                      {invite.isExternal && <span className="ts-external-badge">External</span>}
                    </div>
                    <div className="ts-member-meta">
                      Pending · {ROLES.find(r => r.value === invite.role)?.label}
                    </div>
                  </div>

                  <div className="ts-member-actions">
                    <button
                      className="ts-remove-btn"
                      onClick={() => cancelInvite(invite)}
                      disabled={cancelingId === invite.id}
                      title="Cancel invite"
                    >
                      {cancelingId === invite.id ? <SpinnerInline /> : <TrashIcon />}
                    </button>
                  </div>
                </div>
              ))}

              {members.length === 0 && invites.length === 0 && (
                <p className="ts-empty">No team members yet. Invite someone to get started.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Integrations ── */}
        <div className="mc-page__hd" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Integrations</h2>
        </div>

        <div className="mc-section">
          <div className="mc-integration-card">
            <div className="mc-integration-card__logo">
              <svg width="28" height="28" viewBox="0 0 87.3 78" fill="none">
                <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 52H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                <path d="M43.65 25L29.9 0c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 000 52h27.5z" fill="#00AC47"/>
                <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 56.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#EA4335"/>
                <path d="M43.65 25L57.4 0c-1.35-.8-3.45-1.2-4.65-1.2H34.9c-1.2 0-3.1.4-4.65 1.2z" fill="#00832D"/>
                <path d="M59.8 52H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h49.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC"/>
                <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 52h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
              </svg>
            </div>
            <div className="mc-integration-card__info">
              <h3>Google Drive</h3>
              <p>Auto-sync claim documents and photos to organized Drive folders per client.</p>
            </div>
            <div className="mc-integration-card__action">
              {driveLoading ? (
                <span className="mc-muted">Checking…</span>
              ) : driveStatus?.connected ? (
                <>
                  <span className="mc-badge mc-badge--green">Connected</span>
                  <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={handleDriveDisconnect} disabled={disconnecting}>
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button className="mc-btn mc-btn--primary" onClick={handleDriveConnect} disabled={!orgId}>Connect Drive</button>
              )}
            </div>
          </div>

          <div className="mc-integration-card" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="mc-integration-card__logo" style={{ paddingTop: 4 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <div className="mc-integration-card__info">
              <h3>CompanyCam</h3>
              <p>Link jobsite photo projects to client claims and control which photos homeowners see.</p>
            </div>
            <div className="mc-integration-card__action">
              {ccLoading ? (
                <span className="mc-muted">Checking…</span>
              ) : ccApiKey && !ccEditing ? (
                <>
                  <span className="mc-badge mc-badge--green">Connected</span>
                  <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => { setCcApiInput(ccApiKey); setCcEditing(true); setCcMessage(''); }}>Edit Key</button>
                  <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={handleRemoveCcKey} disabled={ccSaving}>Remove</button>
                </>
              ) : !ccEditing ? (
                <button className="mc-btn mc-btn--primary" onClick={() => { setCcEditing(true); setCcApiInput(''); }}>Connect</button>
              ) : null}
            </div>
            {ccEditing && (
              <form onSubmit={handleSaveCcKey} style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <input
                  type="password"
                  placeholder="Paste CompanyCam API key…"
                  value={ccApiInput}
                  onChange={e => setCcApiInput(e.target.value)}
                  className="mc-input"
                  style={{ flex: 1, minWidth: 0 }}
                  autoFocus
                />
                <button type="submit" className="mc-btn mc-btn--primary" disabled={ccSaving || !ccApiInput.trim()}>
                  {ccSaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => { setCcEditing(false); setCcApiInput(''); setCcMessage(''); }}>
                  Cancel
                </button>
              </form>
            )}
            {ccMessage && (
              <p style={{ width: '100%', margin: '8px 0 0', fontSize: 13, color: ccMessage.includes('Failed') ? '#dc2626' : '#16a34a' }}>
                {ccMessage}
              </p>
            )}
          </div>

          <div className="mc-integration-card mc-integration-card--disabled">
            <div className="mc-integration-card__logo">✉️</div>
            <div className="mc-integration-card__info">
              <h3>SMS Notifications</h3>
              <p>Send automated claim status updates to clients via text message.</p>
            </div>
            <div className="mc-integration-card__action">
              <span className="mc-badge">Coming soon</span>
            </div>
          </div>
        </div>

        {/* ── Sign Templates ── */}
        <div className="mc-page__hd" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Sign Templates
          </h2>
        </div>

        <div className="ts-section">
          <div className="ts-section-header">
            <div className="ts-section-header-row">
              <div>
                <h2 className="ts-section-title">
                  Document Templates
                  <span className="ts-member-count">{templates.length}</span>
                </h2>
                <p className="ts-section-hint">
                  PDF templates with client and contractor signature fields.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  ref={tplFileRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setBuilderFile(f); setEditingTemplate(null); setShowTplBuilder(true); }
                    e.target.value = "";
                  }}
                />
                <button className="ts-invite-btn" onClick={() => tplFileRef.current?.click()}>
                  <PlusIcon /> New Template
                </button>
              </div>
            </div>
          </div>

          {templatesLoading ? (
            <div className="ts-loading"><div className="ts-spinner" /></div>
          ) : templates.length === 0 ? (
            <p className="ts-empty" style={{ padding: "20px 24px" }}>
              No templates yet. Click "New Template" to upload a PDF and place signature fields.
            </p>
          ) : (
            <div className="ts-member-list">
              {templates.map(tpl => {
                const clientFields     = (tpl.fields || []).filter(f => !f.signer || f.signer === "client");
                const contractorFields = (tpl.fields || []).filter(f => f.signer === "contractor");
                const isDeletingThis   = deletingTplId === tpl.id;
                return (
                  <div key={tpl.id} className="ts-member-card">
                    <div className="ts-member-avatar" style={{ background: "#2563eb", color: "#fff", fontSize: 16 }}>
                      ✍
                    </div>
                    <div className="ts-member-info">
                      <div className="ts-member-name">{tpl.name}</div>
                      <div className="ts-member-meta">
                        {clientFields.length} client field{clientFields.length !== 1 ? "s" : ""}
                        {contractorFields.length > 0 && ` · ${contractorFields.length} contractor field${contractorFields.length !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                    <div className="ts-member-actions">
                      <button
                        className="ts-assign-btn"
                        onClick={() => { setEditingTemplate(tpl); setBuilderFile(null); setShowTplBuilder(true); }}
                      >
                        Edit
                      </button>
                      <button
                        className="ts-remove-btn"
                        onClick={() => deleteTemplate(tpl)}
                        disabled={isDeletingThis}
                        title="Delete template"
                      >
                        {isDeletingThis ? <SpinnerInline /> : <TrashIcon />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="ts-legend">
          <div className="ts-legend-item">
            <span className="ts-role-badge ts-role-admin-badge">Admin</span>
            <span>Full access · manage team · see all clients</span>
          </div>
          <div className="ts-legend-item">
            <span className="ts-role-badge ts-role-pm-badge">Project Manager</span>
            <span>Access limited to assigned clients · no team settings</span>
          </div>
        </div>

        {/* ── Partners section ── */}
        <div className="mc-page__hd" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Partners & Referrals</h2>
        </div>

        <div className="ts-section">
          <div className="ts-section-header">
            <div className="ts-section-header-row">
              <div>
                <h2 className="ts-section-title">
                  Partners & Referral Sources
                  <span className="ts-member-count">{partners.length}</span>
                </h2>
                <p className="ts-section-hint">Track which partners and referral sources bring in jobs.</p>
              </div>
            </div>
          </div>

          <div style={{ padding: '20px 28px' }}>
            <div className="ts-partner-add-row">
              <input
                className="ts-input"
                placeholder="Partner or referral source name"
                value={newPartnerName}
                onChange={e => setNewPartnerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPartner()}
              />
              <button className="ts-btn ts-btn--primary" onClick={addPartner} disabled={!newPartnerName.trim() || addingPartner}>
                {addingPartner ? 'Adding…' : 'Add Partner'}
              </button>
            </div>

            {partners.length === 0 ? (
              <p className="ts-empty-msg">No partners added yet. Add a name above to start tracking referrals.</p>
            ) : (
              <div className="ts-partner-list">
                {partners.map(p => (
                  <div key={p.id} className="ts-partner-row">
                    <span className="ts-partner-name">👤 {p.name}</span>
                    <button className="ts-btn--danger-sm" onClick={() => removePartner(p.id)} disabled={removingPartnerId === p.id}>
                      {removingPartnerId === p.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Insurance Companies section ── */}
        <div className="mc-page__hd" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Insurance Companies</h2>
        </div>

        <div className="ts-section">
          <div className="ts-section-header">
            <div className="ts-section-header-row">
              <div>
                <h2 className="ts-section-title">
                  Insurance Companies
                  <span className="ts-member-count">{insurers.length}</span>
                </h2>
                <p className="ts-section-hint">Manage the list of insurance companies for consistent categorization in reports.</p>
              </div>
            </div>
          </div>

          <div style={{ padding: '20px 28px' }}>
            <div className="ts-partner-add-row">
              <input
                className="ts-input"
                placeholder="e.g. State Farm, Allstate, USAA"
                value={newInsurerName}
                onChange={e => setNewInsurerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addInsurer()}
              />
              <button className="ts-btn ts-btn--primary" onClick={addInsurer} disabled={!newInsurerName.trim() || addingInsurer}>
                {addingInsurer ? 'Adding…' : 'Add Insurer'}
              </button>
            </div>

            {insurers.length === 0 ? (
              <p className="ts-empty-msg">No insurance companies added yet. Add one above to start tracking.</p>
            ) : (
              <div className="ts-partner-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {insurers.map(i => (
                  <div key={i.id} className="ts-partner-row">
                    <span className="ts-partner-name">🏛️ {i.name}</span>
                    <button className="ts-btn--danger-sm" onClick={() => removeInsurer(i.id)} disabled={removingInsurerId === i.id}>
                      {removingInsurerId === i.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Data Cleanup ── */}
        <div className="mc-page__hd" style={{ marginTop: 8 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#991b1b', margin: 0 }}>Data Cleanup</h2>
        </div>

        {/* Orphan scan */}
        <div className="ts-section" style={{ border: '1.5px solid #fecaca', marginBottom: 16 }}>
          <div className="ts-section-header" style={{ borderBottom: '1px solid #fecaca', background: '#fff5f5' }}>
            <div className="ts-section-header-row">
              <div>
                <h2 className="ts-section-title" style={{ color: '#991b1b' }}>Scan for Deleted Invoices</h2>
                <p className="ts-section-hint">Finds invoice_summary entries whose source invoice no longer exists and removes them from the Sales Report.</p>
              </div>
            </div>
          </div>
          <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <button
                className="ts-btn ts-btn--primary"
                onClick={scanOrphans}
                disabled={orphanScanning}
                style={{ minWidth: 160 }}
              >
                {orphanScanning ? 'Scanning…' : '🔍 Scan Now'}
              </button>
            </div>

            {orphanDone && (
              <p style={{ fontSize: 13, color: '#15803d', fontWeight: 600, margin: 0 }}>
                ✓ Orphaned invoice records removed from the Sales Report.
              </p>
            )}

            {orphanResults && (
              orphanResults.count === 0 ? (
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>✓ No orphaned invoice records found — the report is clean.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, margin: 0 }}>
                    Found {orphanResults.count} orphaned invoice record{orphanResults.count !== 1 ? 's' : ''} (invoice deleted but still counted in reports):
                  </p>
                  <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 8, overflow: 'hidden' }}>
                    {orphanResults.docs.map(d => (
                      <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #fef2f2', fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{d.clientName}</span>
                        <span style={{ color: '#64748b' }}>{d.issueDate || '—'}</span>
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>
                          {(d.total || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="ts-btn"
                    onClick={deleteOrphans}
                    disabled={orphanDeleting}
                    style={{ background: '#dc2626', color: '#fff', border: 'none', alignSelf: 'flex-start' }}
                  >
                    {orphanDeleting ? 'Removing…' : `Remove All ${orphanResults.count} from Report`}
                  </button>
                </div>
              )
            )}
          </div>
        </div>

        <div className="ts-section" style={{ border: '1.5px solid #fecaca' }}>
          <div className="ts-section-header" style={{ borderBottom: '1px solid #fecaca', background: '#fff5f5' }}>
            <div className="ts-section-header-row">
              <div>
                <h2 className="ts-section-title" style={{ color: '#991b1b' }}>Remove Orphaned Records</h2>
                <p className="ts-section-hint">Search by exact client name to find and delete lingering settlement or invoice records from reports.</p>
              </div>
            </div>
          </div>

          <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="ts-input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Client name"
                value={cleanupName}
                onChange={e => { setCleanupName(e.target.value); setCleanupResults(null); setCleanupDone(false); }}
                onKeyDown={e => e.key === 'Enter' && searchCleanup()}
              />
              <button
                className="ts-btn ts-btn--primary"
                onClick={searchCleanup}
                disabled={cleanupSearching || !cleanupName.trim()}
              >
                {cleanupSearching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {cleanupDone && (
              <p style={{ fontSize: 13, color: '#15803d', fontWeight: 600, margin: 0 }}>
                ✓ All matching records deleted.
              </p>
            )}

            {cleanupResults && (
              cleanupResults.count === 0 ? (
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No records found for that name.</p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, margin: 0 }}>
                    Found {cleanupResults.count} record{cleanupResults.count !== 1 ? 's' : ''} — {cleanupResults.docs.filter(d => d.col === 'settlement_summary').length} settlement, {cleanupResults.docs.filter(d => d.col === 'invoice_summary').length} invoice.
                  </p>
                  <button
                    className="ts-btn"
                    onClick={deleteCleanup}
                    disabled={cleanupDeleting}
                    style={{ background: '#dc2626', color: '#fff', border: 'none' }}
                  >
                    {cleanupDeleting ? 'Deleting…' : `Delete All ${cleanupResults.count} Records`}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Template Builder ── */}
      {showTplBuilder && (builderFile || editingTemplate) && (
        <TemplateBuilder
          pdfFile={builderFile || null}
          existingTemplate={editingTemplate || null}
          orgId={orgId}
          user={user}
          onSave={template => {
            setTemplates(prev => {
              const idx = prev.findIndex(t => t.id === template.id);
              if (idx >= 0) { const n = [...prev]; n[idx] = template; return n; }
              return [template, ...prev];
            });
            setShowTplBuilder(false);
            setBuilderFile(null);
            setEditingTemplate(null);
          }}
          onClose={() => { setShowTplBuilder(false); setBuilderFile(null); setEditingTemplate(null); }}
        />
      )}

      {/* ── Assign Clients Modal ── */}
      {assignModal && (() => {
        const q = assignSearch.toLowerCase();
        const visibleClients = clients.filter(c =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.phone || "").includes(q) ||
          (c.address || "").toLowerCase().includes(q)
        );
        const allVisibleSelected = visibleClients.length > 0 && visibleClients.every(c => assignDraft.includes(c.phone));
        return (
          <>
            <div className="ts-overlay" onClick={() => setAssignModal(null)} />
            <div className="ts-modal ts-assign-modal">
              <div className="ts-modal-header">
                <h2>Manage Client Access</h2>
                <p className="ts-modal-sub">
                  <strong>{assignModal.displayName || assignModal.email}</strong> — select which clients they can view
                </p>
              </div>

              {/* Search + bulk toggle */}
              <div className="ts-assign-toolbar">
                <div className="ts-assign-search-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    className="ts-assign-search"
                    type="text"
                    placeholder="Search clients…"
                    value={assignSearch}
                    onChange={e => setAssignSearch(e.target.value)}
                    autoFocus
                  />
                  {assignSearch && (
                    <button className="ts-assign-search-clear" onClick={() => setAssignSearch("")}>✕</button>
                  )}
                </div>
                <button
                  className="ts-select-all-btn"
                  onClick={() => {
                    if (allVisibleSelected) {
                      setAssignDraft(prev => prev.filter(p => !visibleClients.some(c => c.phone === p)));
                    } else {
                      const toAdd = visibleClients.map(c => c.phone).filter(p => !assignDraft.includes(p));
                      setAssignDraft(prev => [...prev, ...toAdd]);
                    }
                  }}
                >
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="ts-assign-summary">
                <span className="ts-assign-count">
                  {assignDraft.length} client{assignDraft.length !== 1 ? "s" : ""} selected
                </span>
                {assignSearch && (
                  <span className="ts-assign-filter-hint">
                    Showing {visibleClients.length} of {clients.length}
                  </span>
                )}
              </div>

              <div className="ts-client-list">
                {visibleClients.map(client => {
                  const checked = assignDraft.includes(client.phone);
                  const isClosed = client.claimStatus === "closed";
                  const label = client.name || client.phone || "?";
                  return (
                    <label key={client.phone} className={`ts-client-row${checked ? " ts-client-checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssign(client.phone)}
                        className="ts-client-checkbox"
                      />
                      <div className="ts-client-avatar">
                        {label.charAt(0).toUpperCase()}
                      </div>
                      <div className="ts-client-label">
                        <div className="ts-client-name-row">
                          <span className="ts-client-name">{client.name || <span className="ts-muted">No name</span>}</span>
                          <span className={`ts-client-status-badge ts-client-status-badge--${isClosed ? "closed" : "open"}`}>
                            {isClosed ? "Closed" : "Open"}
                          </span>
                        </div>
                        <span className="ts-client-phone">{formatPhone(client.phone)}</span>
                        {client.address && (
                          <span className="ts-client-address">{client.address}</span>
                        )}
                        {client.claimNumbers?.length > 0 && (
                          <span className="ts-client-claim">Claim: {client.claimNumbers.join(", ")}</span>
                        )}
                      </div>
                      {checked && <CheckIcon />}
                    </label>
                  );
                })}
                {visibleClients.length === 0 && (
                  <p className="ts-empty">
                    {clients.length === 0 ? "No clients in this organization yet." : "No clients match your search."}
                  </p>
                )}
              </div>

              <div className="ts-modal-actions">
                <button className="ts-btn-secondary" onClick={() => setAssignModal(null)}>Cancel</button>
                <button className="ts-btn-primary" onClick={saveAssignments} disabled={assignSaving}>
                  {assignSaving ? "Saving…" : `Save (${assignDraft.length} selected)`}
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Invite Member Modal ── */}
      {showInviteModal && (
        <>
          <div className="ts-overlay" onClick={closeInviteModal} />
          <div className="ts-modal ts-invite-modal">
            <div className="ts-modal-header">
              <h2>Invite Team Member</h2>
              <p className="ts-modal-sub">
                They'll be auto-assigned to your organization when they first sign in.
              </p>
            </div>

            <div className="ts-invite-body">
              <label className="ts-invite-label">Email address</label>
              <input
                type="email"
                className="ts-invite-input"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                autoFocus
              />

              <label className="ts-invite-label" style={{ marginTop: 18 }}>Permission level</label>
              <div className="ts-role-pills">
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    className={`ts-role-pill${inviteRole === r.value ? ' ts-role-pill--active' : ''}`}
                    onClick={() => setInviteRole(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {inviteEmail && emailValid && !inviteError && (
                <div className="ts-invite-preview">
                  <strong>{inviteEmail.trim()}</strong> will be invited as an{' '}
                  <strong>{isExternal(inviteEmail) ? 'external user' : 'internal team member'}</strong>{' '}
                  with <strong>{ROLES.find(r => r.value === inviteRole)?.label}</strong> access.
                </div>
              )}

              {inviteError && <p className="ts-invite-error">{inviteError}</p>}
            </div>

            <div className="ts-modal-actions">
              <button className="ts-btn-secondary" onClick={closeInviteModal}>Cancel</button>
              <button
                className="ts-btn-primary"
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
              >
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const formatPhone = (phone = "") => {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
};

const SpinnerInline = () => <div className="ts-spinner-inline" />;

const TeamIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
    <path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
);

const ClientsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, orderBy, where, addDoc, serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "./useAuth";
import { api } from "./api";
import "./TeamSettings.css";

const ROLES = [
  { value: "admin",           label: "Admin" },
  { value: "project_manager", label: "Project Manager" },
];

const encodeEmail = (email) =>
  email.toLowerCase().replace(/\./g, "__dot__").replace(/@/g, "__at__");

export default function TeamSettings() {
  const { user } = useAuth();

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
  const [assignSaving, setAssignSaving] = useState(false);

  // Invite state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail,     setInviteEmail]     = useState('');
  const [inviteRole,      setInviteRole]      = useState('project_manager');
  const [inviting,        setInviting]        = useState(false);
  const [inviteError,     setInviteError]     = useState('');

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
    api.drive.status(user.uid)
      .then(res => setDriveStatus(res))
      .catch(() => setDriveStatus({ connected: false }))
      .finally(() => setDriveLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const oid = userSnap.data()?.organizationId || user.uid;
        if (cancelled) return;
        setOrgId(oid);

        const [contractorSnap, membersSnap, clientsSnap, orgSnap, invitesSnap] = await Promise.all([
          getDoc(doc(db, "organization_data", oid, "contractors", user.uid)),
          getDocs(query(
            collection(db, "organization_data", oid, "contractors"),
            orderBy("lastLogin", "desc")
          )),
          getDocs(query(
            collection(db, "client_phones"),
            where("orgId", "==", oid)
          )),
          getDoc(doc(db, "organization_data", oid)),
          getDocs(query(
            collection(db, "organization_data", oid, "invites"),
            orderBy("invitedAt", "desc")
          )).catch(() => ({ docs: [] })),
        ]);
        if (cancelled) return;

        const role = contractorSnap.data()?.role || "admin";
        setUserRole(role);
        setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        const cl = clientsSnap.docs.map(d => ({ phone: d.id, ...d.data() }));
        cl.sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone));
        setClients(cl);
        setCcApiKey(orgSnap.data()?.companyCamAPI || '');
        setInvites(invitesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } finally {
        if (!cancelled) { setLoading(false); setCcLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
    if (!window.confirm(`Remove ${member.displayName || member.email} from the team? They will lose access on next login.`)) return;
    setRemovingId(member.id);
    try {
      await deleteDoc(doc(db, "organization_data", orgId, "contractors", member.id));
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } finally {
      setRemovingId(null);
    }
  };

  const openAssignModal = (member) => {
    setAssignDraft(member.assignedClients || []);
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
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001';
    // Open the backend /auth URL directly — popup navigates same-origin so
    // Flask session (and PKCE code_verifier) survive through to the callback.
    window.open(
      `${backendUrl}/integrations/google-drive/auth?orgId=${orgId}`,
      'google-drive-auth',
      'width=520,height=640,left=200,top=100'
    );
    // Poll /status until Firestore reflects connected, then update UI
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 80) { clearInterval(interval); return; }
      try {
        const status = await api.drive.status(orgId);
        if (status?.connected) {
          clearInterval(interval);
          setDriveStatus(status);
        }
      } catch {}
    }, 1500);
  }

  async function handleDriveDisconnect() {
    setDisconnecting(true);
    await api.drive.disconnect({ orgId: user.uid }).catch(() => {});
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

  const formatDate = (ts) => {
    if (!ts) return "Never";
    const d = ts.toDate?.() ?? new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteRole('project_manager');
    setInviteError('');
  };

  if (userRole && userRole !== "admin") {
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
                        {role === "project_manager" && (
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

                      {role === "project_manager" && !isYou && (
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
                <button className="mc-btn mc-btn--primary" onClick={handleDriveConnect}>Connect Drive</button>
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
      </div>

      {/* ── Assign Clients Modal ── */}
      {assignModal && (
        <>
          <div className="ts-overlay" onClick={() => setAssignModal(null)} />
          <div className="ts-modal">
            <div className="ts-modal-header">
              <h2>Assign Clients</h2>
              <p className="ts-modal-sub">
                Select which clients <strong>{assignModal.displayName || assignModal.email}</strong> can access
              </p>
            </div>

            <div className="ts-modal-search-row">
              <span className="ts-assign-count">
                {assignDraft.length} of {clients.length} selected
              </span>
              <button
                className="ts-select-all-btn"
                onClick={() => setAssignDraft(
                  assignDraft.length === clients.length ? [] : clients.map(c => c.phone)
                )}
              >
                {assignDraft.length === clients.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="ts-client-list">
              {clients.map(client => {
                const checked = assignDraft.includes(client.phone);
                return (
                  <label key={client.phone} className={`ts-client-row${checked ? " ts-client-checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssign(client.phone)}
                      className="ts-client-checkbox"
                    />
                    <div className="ts-client-avatar">
                      {(client.name || client.phone || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="ts-client-label">
                      <span className="ts-client-name">{client.name || <span className="ts-muted">No name</span>}</span>
                      <span className="ts-client-phone">{formatPhone(client.phone)}</span>
                    </div>
                    {checked && <CheckIcon />}
                  </label>
                );
              })}
              {clients.length === 0 && (
                <p className="ts-empty">No clients in this organization yet.</p>
              )}
            </div>

            <div className="ts-modal-actions">
              <button className="ts-btn-secondary" onClick={() => setAssignModal(null)}>Cancel</button>
              <button className="ts-btn-primary" onClick={saveAssignments} disabled={assignSaving}>
                {assignSaving ? "Saving…" : "Save Assignments"}
              </button>
            </div>
          </div>
        </>
      )}

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

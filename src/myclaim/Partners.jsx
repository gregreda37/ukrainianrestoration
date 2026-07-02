import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import {
  doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { useAuth } from './useAuth'
import './Partners.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMoney = (n) =>
  (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtDate = (ts) => {
  if (!ts) return ''
  const d = ts.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

// ── Empty Add/Edit form ───────────────────────────────────────────────────────

const EMPTY = { name: '', email: '', phone: '' }

// ── Main component ────────────────────────────────────────────────────────────

export default function Partners() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [orgId,    setOrgId]    = useState(null)
  const [partners, setPartners] = useState([])
  const [statsMap, setStatsMap] = useState({})
  const [loading,  setLoading]  = useState(true)

  // ── Add modal ───────────────────────────────────────────────────────────────
  const [showAdd,  setShowAdd]  = useState(false)
  const [addForm,  setAddForm]  = useState(EMPTY)
  const [adding,   setAdding]   = useState(false)
  const [addError, setAddError] = useState('')

  // ── Edit modal ──────────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState(null)
  const [editForm,   setEditForm]   = useState(EMPTY)
  const [editSaving, setEditSaving] = useState(false)
  const [editError,  setEditError]  = useState('')

  // ── Archive confirm ─────────────────────────────────────────────────────────
  const [archiveTarget,  setArchiveTarget]  = useState(null)
  const [archiveSaving,  setArchiveSaving]  = useState(false)

  // ── Delete confirm ──────────────────────────────────────────────────────────
  const [deleteTarget,  setDeleteTarget]  = useState(null)
  const [deleteSaving,  setDeleteSaving]  = useState(false)

  // ── Restore ─────────────────────────────────────────────────────────────────
  const [restoringId, setRestoringId] = useState(null)

  // ── Archived section ─────────────────────────────────────────────────────────
  const [showArchived, setShowArchived] = useState(false)

  // ── Load ─────────────────────────────────────────────────────────────────────

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid))
      const oid = userSnap.data()?.organizationId
      if (!oid) return
      setOrgId(oid)

      const [partnerSnap, settSnap] = await Promise.all([
        getDocs(query(collection(db, 'organization_data', oid, 'partners'), orderBy('name', 'asc'))),
        getDocs(collection(db, 'organization_data', oid, 'settlement_summary')).catch(() => ({ docs: [] })),
      ])

      const map = {}
      settSnap.docs.forEach(d => {
        const s = d.data()
        if (!s.partnerId) return
        if (!map[s.partnerId]) map[s.partnerId] = { claims: 0, submitted: 0, settled: 0, fee: 0 }
        const isSettled = (parseFloat(s.totalSettled) || 0) > 0
        map[s.partnerId].claims    += 1
        map[s.partnerId].submitted += parseFloat(s.totalEstimate) || 0
        if (isSettled) {
          map[s.partnerId].settled += parseFloat(s.totalSettled) || 0
          map[s.partnerId].fee     += parseFloat(s.partnerFee)   || 0
        }
      })
      setStatsMap(map)
      setPartners(partnerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const activePartners   = partners.filter(p => !p.archived)
  const archivedPartners = partners.filter(p => p.archived)

  const activeStats = activePartners.map(p => statsMap[p.id] || { claims: 0, submitted: 0, settled: 0, fee: 0 })
  const totalJobs      = activeStats.reduce((s, x) => s + x.claims,    0)
  const totalSubmitted = activeStats.reduce((s, x) => s + x.submitted, 0)
  const totalSettled   = activeStats.reduce((s, x) => s + x.settled,   0)
  const totalFees      = activeStats.reduce((s, x) => s + x.fee,       0)

  // ── Add handler ───────────────────────────────────────────────────────────────

  function openAdd() {
    setAddForm(EMPTY); setAddError(''); setShowAdd(true)
  }

  async function handleAdd(e) {
    e.preventDefault()
    const name = addForm.name.trim()
    if (!name) { setAddError('Partner name is required.'); return }
    if (activePartners.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setAddError('A partner with this name already exists.'); return
    }
    setAdding(true); setAddError('')
    try {
      const ref = await addDoc(collection(db, 'organization_data', orgId, 'partners'), {
        name,
        email:     addForm.email.trim()  || null,
        phone:     addForm.phone.trim()  || null,
        archived:  false,
        createdAt: serverTimestamp(),
      })
      setPartners(prev =>
        [...prev, { id: ref.id, name, email: addForm.email.trim() || null, phone: addForm.phone.trim() || null, archived: false }]
          .sort((a, b) => a.name.localeCompare(b.name))
      )
      setShowAdd(false)
    } catch { setAddError('Failed to add partner. Please try again.') }
    finally { setAdding(false) }
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  function openEdit(partner, e) {
    e.stopPropagation()
    setEditTarget(partner)
    setEditForm({ name: partner.name || '', email: partner.email || '', phone: partner.phone || '' })
    setEditError('')
  }

  async function handleEditSave(e) {
    e.preventDefault()
    const name = editForm.name.trim()
    if (!name) { setEditError('Partner name is required.'); return }
    const duplicate = activePartners.find(p => p.id !== editTarget.id && p.name.toLowerCase() === name.toLowerCase())
    if (duplicate) { setEditError('Another partner already has this name.'); return }
    setEditSaving(true); setEditError('')
    try {
      await updateDoc(doc(db, 'organization_data', orgId, 'partners', editTarget.id), {
        name,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
      })
      setPartners(prev =>
        prev.map(p => p.id === editTarget.id
          ? { ...p, name, email: editForm.email.trim() || null, phone: editForm.phone.trim() || null }
          : p
        ).sort((a, b) => a.name.localeCompare(b.name))
      )
      setEditTarget(null)
    } catch { setEditError('Failed to save changes. Please try again.') }
    finally { setEditSaving(false) }
  }

  // ── Archive handlers ──────────────────────────────────────────────────────────

  function openArchive(partner, e) {
    e.stopPropagation()
    setArchiveTarget(partner)
  }

  async function doArchive() {
    if (!archiveTarget) return
    setArchiveSaving(true)
    try {
      await updateDoc(doc(db, 'organization_data', orgId, 'partners', archiveTarget.id), {
        archived:   true,
        archivedAt: serverTimestamp(),
      })
      setPartners(prev => prev.map(p =>
        p.id === archiveTarget.id ? { ...p, archived: true, archivedAt: new Date() } : p
      ))
      setArchiveTarget(null)
    } catch { alert('Failed to archive. Please try again.') }
    finally { setArchiveSaving(false) }
  }

  async function handleRestore(partner, e) {
    e.stopPropagation()
    setRestoringId(partner.id)
    try {
      await updateDoc(doc(db, 'organization_data', orgId, 'partners', partner.id), {
        archived:   false,
        archivedAt: null,
      })
      setPartners(prev => prev.map(p =>
        p.id === partner.id ? { ...p, archived: false, archivedAt: null } : p
      ))
    } catch { alert('Failed to restore. Please try again.') }
    finally { setRestoringId(null) }
  }

  // ── Delete handlers ───────────────────────────────────────────────────────────

  function openDelete(partner, e) {
    e.stopPropagation()
    setDeleteTarget(partner)
  }

  async function doDelete() {
    if (!deleteTarget) return
    setDeleteSaving(true)
    try {
      await deleteDoc(doc(db, 'organization_data', orgId, 'partners', deleteTarget.id))
      setPartners(prev => prev.filter(p => p.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch { alert('Failed to delete. Please try again.') }
    finally { setDeleteSaving(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="pt-root"><div className="pt-loading"><div className="pt-spinner" /></div></div>
  )

  return (
    <div className="pt-root">
      <div className="pt-main">

        {/* ── Page header ── */}
        <div className="pt-page-header">
          <div>
            <h1 className="pt-title">Partners & Referrals</h1>
            <p className="pt-subtitle">
              {activePartners.length} active partner{activePartners.length !== 1 ? 's' : ''}
              {totalJobs > 0 && ` · ${totalJobs} referred job${totalJobs !== 1 ? 's' : ''}`}
              {totalFees > 0 && ` · ${fmtMoney(totalFees)} in referral fees`}
            </p>
          </div>
          {isAdmin && (
            <button className="pt-add-btn" onClick={openAdd}>
              <PlusIcon /> Add Partner
            </button>
          )}
        </div>

        {/* ── KPI strip ── */}
        {totalJobs > 0 && (
          <div className="pt-kpi-row">
            <div className="pt-kpi">
              <div className="pt-kpi-label">Referred Jobs</div>
              <div className="pt-kpi-val">{totalJobs}</div>
            </div>
            <div className="pt-kpi pt-kpi--slate">
              <div className="pt-kpi-label">Total Submitted</div>
              <div className="pt-kpi-val">{fmtMoney(totalSubmitted)}</div>
            </div>
            <div className="pt-kpi pt-kpi--green">
              <div className="pt-kpi-label">Total Settled</div>
              <div className="pt-kpi-val">{fmtMoney(totalSettled)}</div>
            </div>
            <div className="pt-kpi pt-kpi--purple">
              <div className="pt-kpi-label">Fees Paid Out</div>
              <div className="pt-kpi-val">{fmtMoney(totalFees)}</div>
            </div>
            <div className="pt-kpi pt-kpi--blue">
              <div className="pt-kpi-label">Company Net</div>
              <div className="pt-kpi-val">{fmtMoney(totalSettled - totalFees)}</div>
            </div>
          </div>
        )}

        {/* ── Active partners ── */}
        {activePartners.length === 0 ? (
          <div className="pt-empty">
            <div className="pt-empty-icon">🤝</div>
            <p className="pt-empty-title">No partners yet</p>
            <p className="pt-empty-sub">Add your first referral source to start tracking performance.</p>
            {isAdmin && (
              <button className="pt-add-btn" onClick={openAdd} style={{ marginTop: 20 }}>
                <PlusIcon /> Add First Partner
              </button>
            )}
          </div>
        ) : (
          <div className="pt-section">
            <div className="pt-section-header">
              <span className="pt-section-title">Active Partners</span>
              <span className="pt-section-count">{activePartners.length}</span>
            </div>

            {/* Table header */}
            <div className="pt-table-head">
              <div className="pt-col-name">Partner</div>
              <div className="pt-col-stat">Jobs</div>
              <div className="pt-col-stat">Submitted</div>
              <div className="pt-col-stat">Settled</div>
              <div className="pt-col-stat">Fee</div>
              <div className="pt-col-stat">Co. Net</div>
              {isAdmin && <div className="pt-col-actions" />}
            </div>

            {activePartners.map(p => {
              const st  = statsMap[p.id] || { claims: 0, submitted: 0, settled: 0, fee: 0 }
              const net = st.settled - st.fee
              return (
                <div
                  key={p.id}
                  className="pt-row"
                  onClick={() => navigate(`/myclaim/partners/${p.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/myclaim/partners/${p.id}`)}
                >
                  {/* Name + contact */}
                  <div className="pt-col-name">
                    <div className="pt-avatar">{initials(p.name)}</div>
                    <div className="pt-identity">
                      <div className="pt-partner-name">{p.name}</div>
                      {p.email && <div className="pt-contact">{p.email}</div>}
                      {p.phone && <div className="pt-contact">{p.phone}</div>}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="pt-col-stat">
                    <div className="pt-stat-val">{st.claims || '—'}</div>
                    <div className="pt-stat-sub">referred</div>
                  </div>
                  <div className="pt-col-stat">
                    <div className="pt-stat-val">{st.submitted > 0 ? fmtMoney(st.submitted) : '—'}</div>
                    <div className="pt-stat-sub">to insurer</div>
                  </div>
                  <div className="pt-col-stat">
                    <div className="pt-stat-val pt-stat-val--green">{st.settled > 0 ? fmtMoney(st.settled) : '—'}</div>
                    <div className="pt-stat-sub">from insurer</div>
                  </div>
                  <div className="pt-col-stat">
                    <div className="pt-stat-val pt-stat-val--purple">{st.fee > 0 ? fmtMoney(st.fee) : '—'}</div>
                    <div className="pt-stat-sub">referral fee</div>
                  </div>
                  <div className="pt-col-stat">
                    <div className="pt-stat-val pt-stat-val--blue" style={{ fontWeight: 800 }}>{net > 0 ? fmtMoney(net) : '—'}</div>
                    <div className="pt-stat-sub">after fee</div>
                  </div>

                  {/* Actions */}
                  {isAdmin && (
                    <div className="pt-col-actions" onClick={e => e.stopPropagation()}>
                      <button className="pt-action-btn pt-action-btn--edit"   title="Edit"    onClick={e => openEdit(p, e)}><EditIcon /></button>
                      <button className="pt-action-btn pt-action-btn--archive" title="Archive" onClick={e => openArchive(p, e)}><ArchiveIcon /></button>
                      <button className="pt-action-btn pt-action-btn--delete"  title="Delete"  onClick={e => openDelete(p, e)}><TrashIcon /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Archived section ── */}
        {archivedPartners.length > 0 && (
          <div className="pt-archived-section">
            <button className="pt-archived-toggle" onClick={() => setShowArchived(v => !v)}>
              <span className="pt-archived-chevron">{showArchived ? '▾' : '▸'}</span>
              <span>Archived</span>
              <span className="pt-archived-count">{archivedPartners.length}</span>
            </button>

            {showArchived && (
              <div className="pt-archived-list">
                {archivedPartners.map(p => (
                  <div key={p.id} className="pt-archived-row">
                    <div className="pt-avatar pt-avatar--muted">{initials(p.name)}</div>
                    <div className="pt-identity">
                      <div className="pt-partner-name pt-partner-name--muted">{p.name}</div>
                      {p.archivedAt && (
                        <div className="pt-contact">Archived {fmtDate(p.archivedAt)}</div>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="pt-archived-actions">
                        <button
                          className="pt-restore-btn"
                          onClick={e => handleRestore(p, e)}
                          disabled={restoringId === p.id}
                        >
                          {restoringId === p.id ? 'Restoring…' : 'Restore'}
                        </button>
                        <button
                          className="pt-action-btn pt-action-btn--delete"
                          title="Delete permanently"
                          onClick={e => openDelete(p, e)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ────────────────────────────────── Modals ──────────────────────────────── */}

      {/* Add Partner Modal */}
      {showAdd && (
        <>
          <div className="pt-overlay" onClick={() => setShowAdd(false)} />
          <div className="pt-modal">
            <div className="pt-modal-header">
              <h2 className="pt-modal-title">Add Partner</h2>
              <button className="pt-modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form className="pt-modal-body" onSubmit={handleAdd}>
              <div className="pt-field">
                <label className="pt-label">Name <span className="pt-required">*</span></label>
                <input
                  className="pt-input"
                  type="text"
                  placeholder="e.g. John Smith or Smith Realty"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="pt-field">
                <label className="pt-label">Email <span className="pt-optional">optional</span></label>
                <input
                  className="pt-input"
                  type="email"
                  placeholder="partner@example.com"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="pt-field">
                <label className="pt-label">Phone <span className="pt-optional">optional</span></label>
                <input
                  className="pt-input"
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={addForm.phone}
                  onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              {addError && <p className="pt-error">{addError}</p>}
              <div className="pt-modal-actions">
                <button type="button" className="pt-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="pt-btn-primary" disabled={adding || !addForm.name.trim()}>
                  {adding ? 'Adding…' : 'Add Partner'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Edit Partner Modal */}
      {editTarget && (
        <>
          <div className="pt-overlay" onClick={() => setEditTarget(null)} />
          <div className="pt-modal">
            <div className="pt-modal-header">
              <h2 className="pt-modal-title">Edit Partner</h2>
              <button className="pt-modal-close" onClick={() => setEditTarget(null)}>✕</button>
            </div>
            <form className="pt-modal-body" onSubmit={handleEditSave}>
              <div className="pt-field">
                <label className="pt-label">Name <span className="pt-required">*</span></label>
                <input
                  className="pt-input"
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="pt-field">
                <label className="pt-label">Email <span className="pt-optional">optional</span></label>
                <input
                  className="pt-input"
                  type="email"
                  placeholder="partner@example.com"
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="pt-field">
                <label className="pt-label">Phone <span className="pt-optional">optional</span></label>
                <input
                  className="pt-input"
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={editForm.phone}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              {editError && <p className="pt-error">{editError}</p>}
              <div className="pt-modal-actions">
                <button type="button" className="pt-btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
                <button type="submit" className="pt-btn-primary" disabled={editSaving || !editForm.name.trim()}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Archive Confirm Modal */}
      {archiveTarget && (
        <>
          <div className="pt-overlay" onClick={() => setArchiveTarget(null)} />
          <div className="pt-modal pt-modal--sm">
            <div className="pt-confirm-icon pt-confirm-icon--amber">
              <ArchiveIcon size={22} />
            </div>
            <h2 className="pt-confirm-title">Archive "{archiveTarget.name}"?</h2>
            <p className="pt-confirm-body">
              They'll be hidden from new settlement forms and the active partner list.
              Their full claim history is preserved and they can be restored at any time.
            </p>
            <div className="pt-modal-actions pt-modal-actions--center">
              <button className="pt-btn-secondary" onClick={() => setArchiveTarget(null)} disabled={archiveSaving}>Cancel</button>
              <button className="pt-btn-amber" onClick={doArchive} disabled={archiveSaving}>
                {archiveSaving ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <>
          <div className="pt-overlay" onClick={() => setDeleteTarget(null)} />
          <div className="pt-modal pt-modal--sm">
            <div className="pt-confirm-icon pt-confirm-icon--red">
              <TrashIcon />
            </div>
            <h2 className="pt-confirm-title">Delete "{deleteTarget.name}" permanently?</h2>
            <p className="pt-confirm-body">
              This cannot be undone. Their name will be removed from the system.
              Settlement records that reference this partner will not be affected.
            </p>
            <div className="pt-modal-actions pt-modal-actions--center">
              <button className="pt-btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleteSaving}>Cancel</button>
              <button className="pt-btn-danger" onClick={doDelete} disabled={deleteSaving}>
                {deleteSaving ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

const ArchiveIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
)

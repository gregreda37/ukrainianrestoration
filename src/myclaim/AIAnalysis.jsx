import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { db, auth } from '../firebase'
import { collection, getDocs, getDoc, doc } from 'firebase/firestore'
import { useAuth } from './useAuth'
import { NavCollapseContext } from './ClaimLayout'
import './AIAnalysis.css'

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:5001' : '/api/backend')

const MITIGATION_LABELS = [
  'Claim Submitted', 'Mitigation in Progress', 'Mitigation Completed',
  'Estimate Submitted', 'Estimate Approved',
]
const CONSTRUCTION_LABELS = [
  'Construction Estimate Received', 'Construction Estimate Approved',
  'Construction Beginning', 'Construction Completes',
]

const QUICK_PROMPTS = [
  {
    icon: '📋', label: 'Claim Summary',
    prompt: 'Provide a comprehensive claim summary for this client. Include: claim and policy numbers, current mitigation progress stage and what it means, current construction progress stage, all pending tasks and who they are assigned to, outstanding documents or approvals needed, budget overview with total, adjuster contact information, and any risks or blockers. Format with clear section headers.',
  },
  {
    icon: '📦', label: 'Inventory List', requiresPhotos: true,
    prompt: 'You are being provided with CompanyCam site photos from this property damage claim. Carefully examine every photo and create a complete inventory list of all visible items — furniture, appliances, personal belongings, building materials, and anything else present.\n\nFormat the output as a markdown table with these exact columns:\n\n| Item | Room | Wrapped | Cleaned |\n\nRules:\n- Item: specific name (e.g. "Sectional sofa", "55\\" Samsung TV", "Wooden dining chair")\n- Room: room it appears in based on photo context\n- Wrapped: Yes or No based on whether it is visibly wrapped or protected\n- Cleaned: Yes by default; only mark No if the item is visibly dirty or clearly uncleaned\n\nAfter the table, note any areas that were not clearly photographed.',
  },
  {
    icon: '🔨', label: 'Labor Logs', requiresPhotos: true, needsInput: true,
    inputLabel: 'Which workers were on site?', inputPlaceholder: 'e.g. John, Maria, Steve', inputRows: 1,
    buildPrompt: (workers) =>
      `Using the CompanyCam photo timestamps as evidence of on-site presence, generate a labor log for: ${workers}.\n\nAssume standard hours 9:00 AM – 5:00 PM (8 hrs/worker) unless timestamps suggest otherwise. If photos show activity outside those hours, use those as actual times.\n\nFormat as a markdown table:\n\n| Worker | Date | Start Time | End Time | Total Hours | Notes |\n\nProvide a total labor hours summary at the bottom. Reference CompanyCam timestamps where available.`,
  },
  {
    icon: '📧', label: 'Adjuster Reply', needsInput: true,
    inputLabel: "Paste the adjuster's question:", inputPlaceholder: 'Paste the adjuster\'s question here…', inputRows: 5,
    buildPrompt: (question) =>
      `An insurance adjuster has sent the following question:\n\n---\n${question}\n---\n\nUsing the complete client case file, write a thorough, professional response. Include specific facts, dates, and figures from the case file. Reference documents or photos where relevant. The response should be ready to send directly to the adjuster.`,
  },
  {
    icon: '⚠️', label: 'Risk Assessment',
    prompt: 'Analyze this claim for risks and blockers. Identify: missing documentation, stalled approvals, overdue tasks, budget gaps, communication issues with the adjuster, and anything that could delay settlement. Rank by urgency and provide a specific recommended next action for each risk.',
  },
  {
    icon: '💰', label: 'Settlement Gap',
    prompt: 'Review the financial data in this claim and calculate any settlement gap. Compare the estimate totals against what has been approved or settled so far. Identify which line items are under-approved and suggest documentation or supplemental claims that could close the gap. Show all numbers clearly.',
  },
]

const DEFAULT_FLAGS = {
  claimInfo: true, todos: true, documents: true,
  selections: true, budget: true, activity: true,
}
const FLAG_LABELS = {
  claimInfo: 'Claim Info', todos: 'Tasks & Todos', documents: 'Documents',
  selections: 'Selections', budget: 'Budget', activity: 'Activity Log',
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function inline(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function MarkdownMessage({ text }) {
  const parts = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^### /.test(line)) { parts.push(<h3 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(4)) }} />); i++ }
    else if (/^## /.test(line)) { parts.push(<h2 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(3)) }} />); i++ }
    else if (/^# /.test(line))  { parts.push(<h1 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }} />); i++ }
    else if (/^[-*] /.test(line)) {
      const items = []
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(<li key={i} dangerouslySetInnerHTML={{ __html: inline(lines[i].slice(2)) }} />); i++ }
      parts.push(<ul key={`ul-${i}`}>{items}</ul>)
    } else if (/^\d+\. /.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(<li key={i} dangerouslySetInnerHTML={{ __html: inline(lines[i].replace(/^\d+\. /, '')) }} />); i++ }
      parts.push(<ol key={`ol-${i}`}>{items}</ol>)
    } else if (/^\|/.test(line.trim())) {
      const tableLines = []
      while (i < lines.length && /^\|/.test(lines[i].trim())) { tableLines.push(lines[i]); i++ }
      const parseRow = (r) => r.split('|').slice(1).map(c => c.trim()).slice(0, -1)
      const isSep = (r) => r.replace(/[\|\-\s:]/g, '') === ''
      const headers = parseRow(tableLines[0])
      const dataRows = tableLines.slice(1).filter(l => !isSep(l)).map(parseRow)
      parts.push(
        <div key={`tw-${i}`} className="aa-md-table-wrap">
          <table className="aa-md-table">
            <thead><tr>{headers.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: inline(h) }} />)}</tr></thead>
            <tbody>{dataRows.map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: inline(c) }} />)}</tr>)}</tbody>
          </table>
        </div>
      )
    } else if (line.trim() === '') { parts.push(<div key={i} className="aa-spacer" />); i++ }
    else { parts.push(<p key={i} dangerouslySetInnerHTML={{ __html: inline(line) }} />); i++ }
  }
  return <div className="aa-md">{parts}</div>
}

// ── Thinking phrases ─────────────────────────────────────────────────────────

const THINKING_PHRASES = [
  'Reading claim documents…',
  'Reviewing tasks and todos…',
  'Checking budget entries…',
  'Scanning document history…',
  'Preparing your response…',
]
const PHOTO_THINKING_PHRASES = [
  'Loading selected photos…',
  'Analyzing site imagery…',
  'Cross-referencing with documents…',
  'Identifying damage patterns…',
  'Preparing your response…',
]

// ── Typewriter component ──────────────────────────────────────────────────────

function TypewriterStatus({ phrases }) {
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [ready, setReady] = useState(false)

  // Small delay so it doesn't flash if first token arrives immediately
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!ready) return
    const current = phrases[phraseIdx % phrases.length]
    if (displayed.length < current.length) {
      const t = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 40)
      return () => clearTimeout(t)
    }
    // Phrase fully typed — pause then advance
    const t = setTimeout(() => {
      setPhraseIdx(i => i + 1)
      setDisplayed('')
    }, 1100)
    return () => clearTimeout(t)
  }, [displayed, phraseIdx, phrases, ready])

  if (!ready) return null
  return (
    <div className="aa-typewriter">
      <span className="aa-typewriter-icon">▸</span>
      <span className="aa-typewriter-text">{displayed || ' '}</span>
      <span className="aa-typewriter-cur" />
    </div>
  )
}

// ── Context loading steps ─────────────────────────────────────────────────────

function LoadingSteps({ includePhotos }) {
  const steps = [
    'Connecting to case file',
    'Loading claim information',
    'Reviewing todos & documents',
    ...(includePhotos ? ['Processing CompanyCam photos', 'Quality-checking imagery'] : []),
    'Building AI context',
  ]
  return (
    <div className="aa-load-steps">
      {steps.map((s, i) => (
        <div key={i} className="aa-load-step" style={{ animationDelay: `${i * 0.55}s` }}>
          <span className="aa-load-step-dot" style={{ animationDelay: `${i * 0.55 + 0.35}s` }} />
          <span className="aa-load-step-text">{s}</span>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtPhone = (p = '') => {
  const d = p.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return p
}
const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

const AVATAR_COLORS = [
  ['#eff6ff','#2563eb'], ['#ecfeff','#0891b2'], ['#f0fdf4','#16a34a'],
  ['#fef9c3','#ca8a04'], ['#fdf4ff','#9333ea'], ['#fff1f2','#e11d48'],
]
const avatarColor = (str = '') => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const ms = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIAnalysis() {
  const { user, isAdmin } = useAuth()
  const collapseNav = useContext(NavCollapseContext)

  const [orgId, setOrgId] = useState('')
  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const [clientView, setClientView] = useState('list')
  const [selectedClient, setSelectedClient] = useState(null)

  const [contextFlags, setContextFlags] = useState(DEFAULT_FLAGS)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextLoaded, setContextLoaded] = useState(false)
  const [clientContext, setClientContext] = useState(null)
  const [photoClassifications, setPhotoClassifications] = useState(null)
  const [classifyStatus, setClassifyStatus] = useState('idle')  // idle|loading|ready|error
  const [selectedPhotoCategory, setSelectedPhotoCategory] = useState(null)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState('')
  const [selectedModel, setSelectedModel] = useState('claude-haiku-4-5-20251001')

  const [activeQuickPrompt, setActiveQuickPrompt] = useState(null)
  const [quickInputText, setQuickInputText] = useState('')

  const [copiedIdx, setCopiedIdx] = useState(null)

  const chatBottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortControllerRef = useRef(null)

  // ── Load org ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) setOrgId(snap.data().organizationId || '')
    })
  }, [user])

  // ── Load clients ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setClientsLoading(true)
    ;(async () => {
      try {
        const [snap, cSnap] = await Promise.all([
          getDocs(collection(db, 'organization_data', orgId, 'clients')),
          getDoc(doc(db, 'organization_data', orgId, 'contractors', user.uid)),
        ])
        if (cancelled) return
        const role = cSnap.exists() ? (cSnap.data()?.role || 'admin') : 'admin'
        const needsFilter = role === 'project_manager' || role === 'public_adjuster'
        const assigned = needsFilter ? (cSnap.data()?.assignedClients || []) : null
        const list = snap.docs
          .map(d => ({ docId: d.id, ...d.data() }))
          .filter(c => !c.archived && (assigned === null || assigned.includes(c.phone)))
        list.sort((a, b) => {
          if (a.claimStatus === b.claimStatus) return (a.name || '').localeCompare(b.name || '')
          return a.claimStatus === 'open' ? -1 : 1
        })
        if (!cancelled) setClients(list)
      } finally {
        if (!cancelled) setClientsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orgId, user])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  // ── Filtered clients ──────────────────────────────────────────────────────
  const filteredClients = clients.filter(c => {
    const q = filter.toLowerCase()
    if (!q) return true
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.claimNumbers || []).some(n => n.toLowerCase().includes(q))
    )
  })

  // ── Select client ─────────────────────────────────────────────────────────
  const handleSelectClient = useCallback((client) => {
    setSelectedClient(client)
    setClientView('detail')
    setContextLoaded(false)
    setClientContext(null)
    setMessages([])
    setStreamError('')
    setPhotoClassifications(null)
    setClassifyStatus('idle')
    setSelectedPhotoCategory(null)
    collapseNav?.()
  }, [collapseNav])

  // ── Terminate session ─────────────────────────────────────────────────────
  const handleTerminateSession = useCallback(() => {
    abortControllerRef.current?.abort()
    setClientView('list')
    setSelectedClient(null)
    setContextLoaded(false)
    setClientContext(null)
    setMessages([])
    setStreamError('')
    setPhotoClassifications(null)
    setClassifyStatus('idle')
    setSelectedPhotoCategory(null)
    setFilter('')
  }, [])

  // ── Load context ──────────────────────────────────────────────────────────
  const handleLoadContext = useCallback(async () => {
    if (!selectedClient || !orgId) return
    setContextLoading(true)
    setContextLoaded(false)
    setMessages([])
    setStreamError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(`${API}/ai/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          clientUid: selectedClient.uid,
          clientName: selectedClient.name || '',
          contextFlags,
          idToken,
        }),
      })
      let data
      try { data = await res.json() }
      catch { throw new Error(`Server returned an error (HTTP ${res.status}) — please try again`) }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setClientContext(data)
      setContextLoaded(true)
    } catch (err) {
      setStreamError(`Failed to load context: ${err.message}`)
    } finally {
      setContextLoading(false)
    }
  }, [selectedClient, orgId, contextFlags])

  // Auto-load context whenever a new client (with uid) is selected
  useEffect(() => {
    if (!selectedClient?.uid || !orgId) return
    handleLoadContext()
  }, [selectedClient?.uid, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClassifyPhotos = useCallback(async () => {
    if (!selectedClient || !orgId || !clientContext) return
    setClassifyStatus('loading')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(`${API}/ai/classify-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          cacheKey: clientContext.cacheKey,
          orgId,
          clientUid: selectedClient.uid,
        }),
      })
      let data
      try { data = await res.json() } catch { throw new Error(`HTTP ${res.status}`) }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setPhotoClassifications({ categories: data.categories || {}, total: data.total || 0 })
      setClassifyStatus('ready')
    } catch (err) {
      setClassifyStatus('error')
      setStreamError(`Photo classification failed: ${err.message}`)
    }
  }, [selectedClient, orgId, clientContext])

  // ── Stop streaming ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  // ── Copy message ──────────────────────────────────────────────────────────
  const handleCopy = useCallback(async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {}
  }, [])

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text, opts = {}) => {
    const msg = (text || input).trim()
    if (!msg || streaming || !contextLoaded) return

    setInput('')
    setStreamError('')

    const userMsg = { role: 'user', content: msg, label: opts.label || null }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    const apiMessages = nextMessages.map(({ role, content }) => ({ role, content }))

    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])
    setStreaming(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          cacheKey: clientContext.cacheKey,
          photoCategory: opts.forcePhotos && classifyStatus === 'ready'
            ? (selectedPhotoCategory || '__all__')
            : (selectedPhotoCategory || ''),
          model: selectedModel,
          idToken,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (errData.error === 'context_expired') {
          setContextLoaded(false)
          setClientContext(null)
          throw new Error('Context expired after 30 min — click Reload Context to continue.')
        }
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6)
            if (payload === '[DONE]') break
            try {
              const parsed = JSON.parse(payload)
              if (parsed.text) {
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.text }
                  return updated
                })
              }
              if (parsed.error) {
                setStreamError(parsed.error)
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { ...updated[updated.length - 1], error: true, content: `Error: ${parsed.error}` }
                  return updated
                })
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // User stopped generation — mark the partial message as complete
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, stopped: true }
          }
          return updated
        })
      } else {
        setStreamError(err.message)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], error: true, content: `Connection error: ${err.message}` }
          return updated
        })
      }
    } finally {
      setMessages(prev => {
        const updated = [...prev]
        if (updated[updated.length - 1]?.streaming) {
          updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
        }
        return updated
      })
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [input, messages, streaming, contextLoaded, clientContext, contextFlags, selectedPhotoCategory, classifyStatus, selectedModel])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleQuickPrompt = useCallback((q) => {
    if (q.needsInput) { setActiveQuickPrompt(q); setQuickInputText('') }
    else handleSend(q.prompt, { label: `${q.icon} ${q.label}`, forcePhotos: !!q.requiresPhotos })
  }, [handleSend])

  const handleQuickInputSubmit = useCallback(() => {
    if (!activeQuickPrompt || !quickInputText.trim()) return
    const fullPrompt = activeQuickPrompt.buildPrompt(quickInputText.trim())
    const label = `${activeQuickPrompt.icon} ${activeQuickPrompt.label}`
    const forcePhotos = !!activeQuickPrompt.requiresPhotos
    setActiveQuickPrompt(null)
    setQuickInputText('')
    handleSend(fullPrompt, { label, forcePhotos })
  }, [activeQuickPrompt, quickInputText, handleSend])

  // ── Derived ───────────────────────────────────────────────────────────────
  const summary = clientContext?.clientSummary
  const stats = clientContext?.stats
  const mitLabel = summary ? (MITIGATION_LABELS[summary.mitigationStep] || 'Not started') : null
  const conLabel = summary ? (CONSTRUCTION_LABELS[summary.constructionStep] || 'Not started') : null
  const [avatarBg, avatarFg] = avatarColor(summary?.name || selectedClient?.name || '')

  const userInitial = (user?.displayName || user?.email || 'U')[0].toUpperCase()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="aa-root">

      {/* ── Left sidebar ── */}
      <aside className="aa-sidebar">
        <div className="aa-sidebar-header">
          <span className="aa-sidebar-title">AI Analysis</span>
          <span className="aa-model-badge">
            {selectedModel === 'claude-sonnet-4-6' ? 'Sonnet' : 'Haiku'}
          </span>
        </div>

        {/* LIST VIEW */}
        {clientView === 'list' && (
          <div className="aa-client-list-panel">
            <div className="aa-list-filter-wrap">
              <input
                className="aa-list-filter"
                placeholder={clientsLoading ? 'Loading…' : `Search ${clients.length} clients…`}
                value={filter}
                onChange={e => setFilter(e.target.value)}
                disabled={clientsLoading}
              />
            </div>
            <div className="aa-client-list">
              {clientsLoading ? (
                <div className="aa-list-loading"><span className="aa-btn-spinner" /></div>
              ) : filteredClients.length === 0 ? (
                <div className="aa-list-empty">No clients found</div>
              ) : filteredClients.map(c => {
                const [bg, fg] = avatarColor(c.name || c.phone || '')
                return (
                  <button
                    key={c.docId}
                    className={`aa-client-row${selectedClient?.docId === c.docId ? ' aa-client-row--active' : ''}`}
                    onClick={() => handleSelectClient(c)}
                  >
                    <div className="aa-client-row-avatar" style={{ background: bg, color: fg }}>
                      {(c.name || c.phone || '?')[0].toUpperCase()}
                    </div>
                    <div className="aa-client-row-info">
                      <div className="aa-client-row-name">{c.name || c.phone || '—'}</div>
                      {c.address && <div className="aa-client-row-addr">{c.address}</div>}
                    </div>
                    {c.claimStatus === 'open' && <span className="aa-client-row-badge">Open</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* DETAIL VIEW */}
        {clientView === 'detail' && selectedClient && (
          <div className="aa-detail-panel">
            <div className="aa-detail-topbar">
              <button className="aa-back-btn" onClick={() => { setClientView('list'); setFilter('') }}>
                ← Clients
              </button>
              <button className="aa-terminate-btn" onClick={handleTerminateSession} title="End session">
                End Session
              </button>
            </div>

            <div className="aa-selected-card">
              <div className="aa-client-avatar" style={{ background: avatarBg, color: avatarFg }}>
                {(selectedClient.name || selectedClient.phone || '?')[0].toUpperCase()}
              </div>
              <div className="aa-client-info">
                <div className="aa-client-name">{selectedClient.name || '—'}</div>
                <div className="aa-client-detail">{fmtPhone(selectedClient.phone)}</div>
                {selectedClient.address && <div className="aa-client-detail aa-client-addr">{selectedClient.address}</div>}
              </div>
            </div>

            <div className="aa-section">
              <div className="aa-section-label">Include in context</div>
              <div className="aa-flags">
                {Object.entries(FLAG_LABELS).map(([key, label]) => (
                  <label key={key} className="aa-flag-row">
                    <input type="checkbox" checked={contextFlags[key]}
                      onChange={() => setContextFlags(prev => ({ ...prev, [key]: !prev[key] }))} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button
                className="aa-load-btn"
                onClick={handleLoadContext}
                disabled={contextLoading || !selectedClient.uid}
              >
                {contextLoading
                  ? <><span className="aa-btn-spinner" /> Loading context…</>
                  : '↺ Reload Context'}
              </button>
            </div>

            {contextLoaded && stats && summary && (
              <div className="aa-section">
                <div className="aa-section-label">Context loaded · {timeAgo(clientContext?.expiresAt ? new Date(new Date(clientContext.expiresAt).getTime() - 30 * 60 * 1000).toISOString() : null)}</div>

                {summary.claimNumbers?.length > 0 && (
                  <div className="aa-stat-row">
                    <span className="aa-stat-label">Claim #</span>
                    <span className="aa-stat-val">{summary.claimNumbers[0]}</span>
                  </div>
                )}

                <div className="aa-progress-section">
                  <div className="aa-progress-label">Mitigation</div>
                  <div className="aa-progress-bar-wrap">
                    <div className="aa-progress-bar" style={{ width: `${Math.max(0, ((summary.mitigationStep + 1) / 5) * 100)}%`, background: '#2563eb' }} />
                  </div>
                  <div className="aa-progress-text">{mitLabel}</div>
                  <div className="aa-progress-label" style={{ marginTop: 8 }}>Construction</div>
                  <div className="aa-progress-bar-wrap">
                    <div className="aa-progress-bar" style={{ width: `${Math.max(0, ((summary.constructionStep + 1) / 4) * 100)}%`, background: '#16a34a' }} />
                  </div>
                  <div className="aa-progress-text">{conLabel}</div>
                </div>

                <div className="aa-stats-grid">
                  <div className="aa-stat-chip"><div className="aa-stat-chip-val">{stats.pendingTodos ?? 0}</div><div className="aa-stat-chip-lbl">Tasks</div></div>
                  <div className="aa-stat-chip"><div className="aa-stat-chip-val">{stats.documentCount ?? 0}</div><div className="aa-stat-chip-lbl">Documents</div></div>
                  <div className="aa-stat-chip"><div className="aa-stat-chip-val">{stats.selectionCount ?? 0}</div><div className="aa-stat-chip-lbl">Selections</div></div>
                  <div className="aa-stat-chip"><div className="aa-stat-chip-val">{photoClassifications?.total ?? stats.photoCount ?? 0}</div><div className="aa-stat-chip-lbl">Photos</div></div>
                </div>

                {stats.budgetTotal > 0 && (
                  <div className="aa-budget-total">
                    <span className="aa-stat-label">Budget</span>
                    <span className="aa-budget-amount">{fmtCurrency(stats.budgetTotal)}</span>
                  </div>
                )}

                {summary.adjuster?.name && (
                  <div className="aa-adjuster-block">
                    <div className="aa-section-label" style={{ marginBottom: 4 }}>Adjuster</div>
                    <div className="aa-adjuster-name">{summary.adjuster.name}</div>
                    {summary.adjuster.company && <div className="aa-adjuster-detail">{summary.adjuster.company}</div>}
                  </div>
                )}

                {stats.hasPhotos && (
                  <div className="aa-photos-section">
                    <div className="aa-section-label" style={{ marginTop: 12 }}>CompanyCam Photos</div>
                    {classifyStatus === 'idle' && (
                      <button className="aa-load-btn" onClick={handleClassifyPhotos}>
                        Analyze &amp; Classify Photos
                      </button>
                    )}
                    {classifyStatus === 'loading' && (
                      <div className="aa-classify-loading">
                        <span className="aa-btn-spinner" /> Classifying photos…
                      </div>
                    )}
                    {classifyStatus === 'ready' && photoClassifications && (
                      <>
                        <div className="aa-photos-summary">
                          {photoClassifications.total} photos · {Object.keys(photoClassifications.categories).length} categories
                        </div>
                        <div className="aa-photo-cats">
                          {Object.entries(photoClassifications.categories)
                            .sort((a, b) => b[1].length - a[1].length)
                            .map(([cat, photos]) => (
                              <button
                                key={cat}
                                className={`aa-cat-chip${selectedPhotoCategory === cat ? ' aa-cat-chip--active' : ''}`}
                                onClick={() => setSelectedPhotoCategory(prev => prev === cat ? null : cat)}
                              >
                                {cat}
                                <span className="aa-cat-count">{photos.length}</span>
                              </button>
                            ))}
                        </div>
                        {selectedPhotoCategory && (
                          <button className="aa-clear-cat-btn" onClick={() => setSelectedPhotoCategory(null)}>
                            ✕ Clear photo filter
                          </button>
                        )}
                        <button
                          className="aa-load-btn"
                          style={{ marginTop: 8 }}
                          onClick={handleClassifyPhotos}
                        >
                          ↺ Re-classify
                        </button>
                      </>
                    )}
                    {classifyStatus === 'error' && (
                      <button className="aa-load-btn" onClick={handleClassifyPhotos}>
                        ↺ Retry Classification
                      </button>
                    )}
                  </div>
                )}

                {messages.length > 0 && (
                  <button className="aa-clear-btn" onClick={() => { setMessages([]); setStreamError('') }}>
                    Clear conversation
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Main chat area ── */}
      <div className="aa-chat-area">

        {/* Empty states */}
        {!selectedClient && (
          <div className="aa-empty-state">
            <div className="aa-empty-orb" />
            <h2 className="aa-empty-title">AI Claim Analysis</h2>
            <p className="aa-empty-desc">
              Select a client, load their context, and ask anything about their claim —
              documents, photos, budget, tasks, and more.
            </p>
            <div className="aa-empty-chips">
              {QUICK_PROMPTS.map(q => <div key={q.label} className="aa-empty-chip"><span>{q.icon}</span> {q.label}</div>)}
            </div>
          </div>
        )}

        {selectedClient && !contextLoaded && !contextLoading && (
          <div className="aa-empty-state">
            <div className="aa-empty-icon">📂</div>
            <h2 className="aa-empty-title">{selectedClient.name || 'Client selected'}</h2>
            <p className="aa-empty-desc">Loading claim context…</p>
          </div>
        )}

        {contextLoading && (
          <div className="aa-empty-state aa-empty-state--loading">
            <div className="aa-loading-ring" />
            <p className="aa-loading-label">
              Loading claim context…
            </p>
            <LoadingSteps includePhotos={false} />
          </div>
        )}

        {/* Welcome / quick prompts */}
        {contextLoaded && messages.length === 0 && !streaming && (
          <div className="aa-welcome">
            <div className="aa-welcome-header">
              <span className="aa-welcome-icon">✓</span>
              <span>Context loaded for <strong>{summary?.name}</strong></span>
            </div>
            {classifyStatus === 'ready' && photoClassifications?.total > 0 && (
              <div className="aa-welcome-photos">
                📸 {photoClassifications.total} photos classified · {selectedPhotoCategory
                  ? `filtering by "${selectedPhotoCategory}"`
                  : 'select a category in the sidebar to include photos'}
              </div>
            )}
            <p className="aa-welcome-hint">Ask anything or pick a quick prompt:</p>
            <div className="aa-quick-prompts">
              {QUICK_PROMPTS.map(q => (
                <button key={q.label} className="aa-quick-btn" onClick={() => handleQuickPrompt(q)}>
                  <span className="aa-quick-icon">{q.icon}</span>
                  <span>{q.label}</span>
                  {q.requiresPhotos && classifyStatus === 'ready' && <span className="aa-quick-photo-badge">📷</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="aa-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`aa-message aa-message--${msg.role}${msg.error ? ' aa-message--error' : ''}${msg.streaming ? ' aa-message--streaming' : ''}`}>

                {msg.role === 'user' ? (
                  <>
                    <div className="aa-message-bubble">
                      {msg.label
                        ? <div className="aa-action-badge">{msg.label}</div>
                        : <p>{msg.content}</p>}
                    </div>
                    <div className="aa-user-avatar">{userInitial}</div>
                  </>
                ) : (
                  <>
                    <div className={`aa-ai-orb${msg.streaming ? ' aa-ai-orb--active' : ''}`} />
                    <div className="aa-message-bubble">
                      {msg.content ? <MarkdownMessage text={msg.content} /> : null}
                      {msg.streaming && !msg.content && (
                        <TypewriterStatus
                          phrases={selectedPhotoCategory ? PHOTO_THINKING_PHRASES : THINKING_PHRASES}
                        />
                      )}
                      {msg.streaming && msg.content && <span className="aa-cursor">▋</span>}
                      {msg.stopped && <span className="aa-stopped-badge">— stopped</span>}
                      {!msg.streaming && !msg.error && msg.content && (
                        <button
                          className={`aa-copy-btn${copiedIdx === idx ? ' aa-copy-btn--copied' : ''}`}
                          onClick={() => handleCopy(msg.content, idx)}
                          title="Copy response"
                        >
                          {copiedIdx === idx ? '✓ Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        )}

        {/* Error banner */}
        {streamError && (
          <div className="aa-error-banner">
            <span>{streamError}</span>
            <button className="aa-error-dismiss" onClick={() => setStreamError('')}>✕</button>
          </div>
        )}

        {/* Input area */}
        {contextLoaded && (
          <div className="aa-input-area">

            {/* Quick input card */}
            {activeQuickPrompt && (
              <div className="aa-quick-input-card">
                <div className="aa-quick-input-header">
                  <span className="aa-quick-input-icon">{activeQuickPrompt.icon}</span>
                  <span className="aa-quick-input-title">{activeQuickPrompt.label}</span>
                  <button className="aa-quick-input-cancel" onClick={() => setActiveQuickPrompt(null)}>✕</button>
                </div>
                <label className="aa-quick-input-label">{activeQuickPrompt.inputLabel}</label>
                <textarea
                  className="aa-quick-input-textarea"
                  placeholder={activeQuickPrompt.inputPlaceholder}
                  rows={activeQuickPrompt.inputRows || 2}
                  value={quickInputText}
                  onChange={e => setQuickInputText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && activeQuickPrompt.inputRows === 1) {
                      e.preventDefault(); handleQuickInputSubmit()
                    }
                  }}
                  autoFocus
                />
                <div className="aa-quick-input-actions">
                  <button className="aa-quick-input-submit" onClick={handleQuickInputSubmit} disabled={!quickInputText.trim()}>
                    Send to Claude ↑
                  </button>
                </div>
              </div>
            )}

            {/* Quick pill bar */}
            {messages.length > 0 && !streaming && !activeQuickPrompt && (
              <div className="aa-quick-bar">
                {QUICK_PROMPTS.map(q => (
                  <button key={q.label} className="aa-quick-pill" onClick={() => handleQuickPrompt(q)}>
                    {q.icon} {q.label}
                  </button>
                ))}
              </div>
            )}

            {/* Textarea + send/stop */}
            <div className="aa-input-row">
              <textarea
                ref={inputRef}
                className="aa-textarea"
                placeholder={streaming ? 'Claude is responding…' : 'Ask about this client\'s claim…'}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                rows={1}
              />
              {streaming ? (
                <button className="aa-stop-btn" onClick={handleStop} title="Stop generating">
                  <span className="aa-stop-icon">■</span>
                </button>
              ) : (
                <button className="aa-send-btn" onClick={() => handleSend()} disabled={!input.trim()}>↑</button>
              )}
            </div>

            <div className="aa-input-footer">
              <span className="aa-input-hint">Enter to send · Shift+Enter for new line</span>
              {selectedPhotoCategory && (
                <span className="aa-photo-hint">📸 {selectedPhotoCategory}</span>
              )}
              {isAdmin && (
                <select className="aa-model-select" value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)} disabled={streaming}>
                  <option value="claude-haiku-4-5-20251001">Haiku — Fast</option>
                  <option value="claude-sonnet-4-6">Sonnet — Detailed</option>
                </select>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

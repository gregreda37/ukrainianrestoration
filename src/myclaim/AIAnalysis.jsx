import { useState, useRef, useEffect, useCallback, useContext } from "react";
import { db, auth } from "../firebase";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";
import { useAuth } from "./useAuth";
import { NavCollapseContext } from "./ClaimLayout";
import "./AIAnalysis.css";

const API = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:5001" : "/api/backend");

const MITIGATION_LABELS = [
  "Claim Submitted", "Mitigation in Progress", "Mitigation Completed",
  "Estimate Submitted", "Estimate Approved",
];
const CONSTRUCTION_LABELS = [
  "Construction Estimate Received", "Construction Estimate Approved",
  "Construction Beginning", "Construction Completes",
];

const QUICK_PROMPTS = [
  {
    icon: "📋",
    label: "Claim Summary",
    prompt:
      "Provide a comprehensive claim summary for this client. Include: claim and policy numbers, current mitigation progress stage and what it means, current construction progress stage, all pending tasks and who they are assigned to, outstanding documents or approvals needed, budget overview with total, adjuster contact information, and any risks or blockers. Format with clear section headers.",
  },
  {
    icon: "📦",
    label: "Inventory List",
    requiresPhotos: true,
    prompt:
      "You are being provided with CompanyCam site photos from this property damage claim. Carefully examine every photo and create a complete inventory list of all visible items — furniture, appliances, personal belongings, building materials, and anything else present.\n\nFormat the output as a markdown table with these exact columns:\n\n| Item | Room | Wrapped | Cleaned |\n\nRules:\n- Item: specific name (e.g. \"Sectional sofa\", \"55\" Samsung TV\", \"Wooden dining chair\")\n- Room: room it appears in based on photo context (e.g. \"Living Room\", \"Master Bedroom\", \"Kitchen\")\n- Wrapped: Yes or No based on whether it is visibly wrapped or protected in the photo\n- Cleaned: Yes by default for every item; only mark No if the item is visibly dirty, stained, or clearly uncleaned\n\nAfter the table, note any areas that were not clearly photographed or items that could not be confidently identified.",
  },
  {
    icon: "🔨",
    label: "Labor Logs",
    needsInput: true,
    inputLabel: "Which workers were on site?",
    inputPlaceholder: "e.g. John, Maria, Steve",
    inputRows: 1,
    buildPrompt: (workers) =>
      `Using the CompanyCam photo timestamps as evidence of on-site presence, generate a labor log for the following workers: ${workers}.\n\nAssume standard working hours are 9:00 AM – 5:00 PM (8 hours per worker) unless CompanyCam timestamps suggest otherwise. If photo timestamps show activity before 9 AM or after 5 PM, use those as the actual start/end times.\n\nFormat the output as a markdown table:\n\n| Worker | Date | Start Time | End Time | Total Hours | Notes |\n\nThen provide a total labor hours summary at the bottom. Reference specific CompanyCam timestamps where available to support the hours logged.`,
  },
  {
    icon: "📧",
    label: "Adjuster Question",
    needsInput: true,
    inputLabel: "Paste the adjuster's question from their email:",
    inputPlaceholder: "Paste the adjuster's question here…",
    inputRows: 5,
    buildPrompt: (question) =>
      `An insurance adjuster has sent the following question:\n\n---\n${question}\n---\n\nUsing the complete client case file provided, write a thorough, professional response to this question. Include:\n- Specific facts, dates, and figures from the case file\n- References to documents or photos where relevant\n- Clear, direct answers to everything asked\n- A professional tone suitable for insurance correspondence\n\nThe response should be ready to copy and send directly to the adjuster.`,
  },
];

const DEFAULT_FLAGS = {
  claimInfo: true,
  todos: true,
  documents: true,
  selections: true,
  budget: true,
  photos: true,
  activity: true,
};

const FLAG_LABELS = {
  claimInfo: "Claim Info",
  todos: "Tasks & Todos",
  documents: "Documents",
  selections: "Selections",
  budget: "Budget",
  photos: "CompanyCam Photos",
  activity: "Activity Log",
};

// ── Lightweight markdown renderer ─────────────────────────────────────────────
function inline(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function MarkdownMessage({ text }) {
  const parts = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^### /.test(line)) {
      parts.push(<h3 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(4)) }} />);
      i++;
    } else if (/^## /.test(line)) {
      parts.push(<h2 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(3)) }} />);
      i++;
    } else if (/^# /.test(line)) {
      parts.push(<h1 key={i} dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }} />);
      i++;
    } else if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(<li key={i} dangerouslySetInnerHTML={{ __html: inline(lines[i].slice(2)) }} />);
        i++;
      }
      parts.push(<ul key={`ul-${i}`}>{items}</ul>);
    } else if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i} dangerouslySetInnerHTML={{ __html: inline(lines[i].replace(/^\d+\. /, "")) }} />);
        i++;
      }
      parts.push(<ol key={`ol-${i}`}>{items}</ol>);
    } else if (/^\|/.test(line.trim())) {
      const tableLines = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = (row) => row.split("|").slice(1).map(c => c.trim()).slice(0, -1);
      const isSep = (row) => row.replace(/[\|\-\s:]/g, "") === "";
      const headers = parseRow(tableLines[0]);
      const dataRows = tableLines.slice(1).filter(l => !isSep(l)).map(parseRow);
      parts.push(
        <div key={`tw-${i}`} className="aa-md-table-wrap">
          <table className="aa-md-table">
            <thead>
              <tr>{headers.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: inline(h) }} />)}</tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: inline(c) }} />)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (line.trim() === "") {
      parts.push(<div key={i} className="aa-spacer" />);
      i++;
    } else {
      parts.push(<p key={i} dangerouslySetInnerHTML={{ __html: inline(line) }} />);
      i++;
    }
  }

  return <div className="aa-md">{parts}</div>;
}

// ── Thinking / streaming indicators ──────────────────────────────────────────
function ThinkingState() {
  return (
    <div className="aa-thinking">
      <span className="aa-thinking-label">Analyzing</span>
      <span className="aa-thinking-dots"><span /><span /><span /></span>
    </div>
  );
}

function StreamingDots() {
  return <span className="aa-streaming-dots"><span /><span /><span /></span>;
}

// ── Format helpers ────────────────────────────────────────────────────────────
const fmtPhone = (p = "") => {
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
};

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const AVATAR_COLORS = [
  ["#eff6ff", "#2563eb"], ["#ecfeff", "#0891b2"], ["#f0fdf4", "#16a34a"],
  ["#fef9c3", "#ca8a04"], ["#fdf4ff", "#9333ea"], ["#fff1f2", "#e11d48"],
];
const avatarColor = (str = "") => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

// ── Main component ────────────────────────────────────────────────────────────
export default function AIAnalysis() {
  const { user } = useAuth();
  const collapseNav = useContext(NavCollapseContext);

  const [orgId, setOrgId] = useState("");
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [filter, setFilter] = useState("");

  // "list" = browsing clients, "detail" = client selected + context controls
  const [clientView, setClientView] = useState("list");
  const [selectedClient, setSelectedClient] = useState(null);

  const [contextFlags, setContextFlags] = useState(DEFAULT_FLAGS);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [clientContext, setClientContext] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState("");

  // For prompts that need a user-supplied input before sending
  const [activeQuickPrompt, setActiveQuickPrompt] = useState(null); // QUICK_PROMPTS entry
  const [quickInputText, setQuickInputText] = useState("");

  const chatBottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Load org ID ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (snap.exists()) setOrgId(snap.data().organizationId || "");
    });
  }, [user]);

  // ── Load client list ─────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    setClientsLoading(true);
    getDocs(collection(db, "organization_data", orgId, "clients"))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
        list.sort((a, b) => {
          if (a.claimStatus === b.claimStatus) return (a.name || "").localeCompare(b.name || "");
          return a.claimStatus === "open" ? -1 : 1;
        });
        setClients(list);
      })
      .finally(() => setClientsLoading(false));
  }, [orgId]);

  // ── Auto-scroll chat ─────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Filtered client list ─────────────────────────────────────────
  const filteredClients = clients.filter((c) => {
    const q = filter.toLowerCase();
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
      (c.address || "").toLowerCase().includes(q) ||
      (c.claimNumbers || []).some((n) => n.toLowerCase().includes(q))
    );
  });

  // ── Select client ────────────────────────────────────────────────
  const handleSelectClient = useCallback((client) => {
    setSelectedClient(client);
    setClientView("detail");
    setContextLoaded(false);
    setClientContext(null);
    setMessages([]);
    setStreamError("");
    collapseNav?.();
  }, [collapseNav]);

  // ── Back to client list ──────────────────────────────────────────
  const handleBackToList = useCallback(() => {
    setClientView("list");
    setFilter("");
  }, []);

  // ── Load context ─────────────────────────────────────────────────
  const handleLoadContext = useCallback(async () => {
    if (!selectedClient || !orgId) return;
    setContextLoading(true);
    setContextLoaded(false);
    setMessages([]);
    setStreamError("");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(`${API}/ai/context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Firebase-ID-Token": idToken,
        },
        body: JSON.stringify({
          orgId,
          clientUid: selectedClient.uid,
          clientName: selectedClient.name || "",
          contextFlags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load context");
      // cacheKey stored server-side; contextString never touches the client
      setClientContext(data);
      setContextLoaded(true);
    } catch (err) {
      setStreamError(`Failed to load context: ${err.message}`);
    } finally {
      setContextLoading(false);
    }
  }, [selectedClient, orgId, contextFlags]);

  // ── Send message ─────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text, opts = {}) => {
      const msg = (text || input).trim();
      if (!msg || streaming || !contextLoaded) return;

      setInput("");
      setStreamError("");

      const userMsg = { role: "user", content: msg, label: opts.label || null };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      // Strip UI-only fields before sending to backend
      const apiMessages = nextMessages.map(({ role, content }) => ({ role, content }));

      // Placeholder for streaming assistant reply
      setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
      setStreaming(true);

      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch(`${API}/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Firebase-ID-Token": idToken,
          },
          body: JSON.stringify({
            messages: apiMessages,
            cacheKey: clientContext.cacheKey,
            includePhotos: contextFlags.photos && (clientContext?.stats?.photoCount > 0),
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (errData.error === "context_expired") {
            // Auto-reset so the user sees the reload prompt clearly
            setContextLoaded(false);
            setClientContext(null);
            throw new Error("Context expired after 30 min — click Reload Context to continue.");
          }
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") break;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.text) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    updated[updated.length - 1] = { ...last, content: last.content + parsed.text };
                    return updated;
                  });
                }
                if (parsed.error) {
                  setStreamError(parsed.error);
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      error: true,
                      content: `Error: ${parsed.error}`,
                    };
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      } catch (err) {
        setStreamError(err.message);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            error: true,
            content: `Connection error: ${err.message}`,
          };
          return updated;
        });
      } finally {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.streaming) {
            updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
          }
          return updated;
        });
        setStreaming(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [input, messages, streaming, contextLoaded, clientContext, contextFlags]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Quick prompt click ────────────────────────────────────────────
  const handleQuickPrompt = useCallback((q) => {
    if (q.needsInput) {
      setActiveQuickPrompt(q);
      setQuickInputText("");
    } else {
      handleSend(q.prompt, { label: `${q.icon} ${q.label}` });
    }
  }, [handleSend]);

  // ── Submit the input card (Labor Logs / Adjuster Question) ────────
  const handleQuickInputSubmit = useCallback(() => {
    if (!activeQuickPrompt || !quickInputText.trim()) return;
    const fullPrompt = activeQuickPrompt.buildPrompt(quickInputText.trim());
    const label = `${activeQuickPrompt.icon} ${activeQuickPrompt.label}`;
    setActiveQuickPrompt(null);
    setQuickInputText("");
    handleSend(fullPrompt, { label });
  }, [activeQuickPrompt, quickInputText, handleSend]);

  // ── Derived ──────────────────────────────────────────────────────
  const summary = clientContext?.clientSummary;
  const stats = clientContext?.stats;
  const mitLabel = summary ? (MITIGATION_LABELS[summary.mitigationStep] || "Not started") : null;
  const conLabel = summary ? (CONSTRUCTION_LABELS[summary.constructionStep] || "Not started") : null;
  const [avatarBg, avatarFg] = avatarColor(summary?.name || selectedClient?.name || "");

  return (
    <div className="aa-root">
      {/* ── Left panel ── */}
      <aside className="aa-sidebar">
        <div className="aa-sidebar-header">
          <span className="aa-sidebar-title">AI Analysis</span>
          <span className="aa-model-badge">claude-sonnet-4-6</span>
        </div>

        {/* ── LIST VIEW: show all clients ── */}
        {clientView === "list" && (
          <div className="aa-client-list-panel">
            <div className="aa-list-filter-wrap">
              <input
                className="aa-list-filter"
                placeholder={clientsLoading ? "Loading…" : `Filter ${clients.length} clients…`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={clientsLoading}
              />
            </div>

            <div className="aa-client-list">
              {clientsLoading ? (
                <div className="aa-list-loading"><span className="aa-btn-spinner" /></div>
              ) : filteredClients.length === 0 ? (
                <div className="aa-list-empty">No clients found</div>
              ) : (
                filteredClients.map((c) => {
                  const [bg, fg] = avatarColor(c.name || c.phone || "");
                  return (
                    <button
                      key={c.docId}
                      className={`aa-client-row${selectedClient?.docId === c.docId ? " aa-client-row--active" : ""}`}
                      onClick={() => handleSelectClient(c)}
                    >
                      <div className="aa-client-row-avatar" style={{ background: bg, color: fg }}>
                        {(c.name || c.phone || "?")[0].toUpperCase()}
                      </div>
                      <div className="aa-client-row-info">
                        <div className="aa-client-row-name">{c.name || c.phone || "—"}</div>
                        {c.address && (
                          <div className="aa-client-row-addr">{c.address}</div>
                        )}
                      </div>
                      {c.claimStatus === "open" && (
                        <span className="aa-client-row-badge">Open</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── DETAIL VIEW: selected client + context controls ── */}
        {clientView === "detail" && selectedClient && (
          <div className="aa-detail-panel">
            <button className="aa-back-btn" onClick={handleBackToList}>
              ← All Clients
            </button>

            {/* Selected client card */}
            <div className="aa-selected-card">
              <div className="aa-client-avatar" style={{ background: avatarBg, color: avatarFg }}>
                {(selectedClient.name || selectedClient.phone || "?")[0].toUpperCase()}
              </div>
              <div className="aa-client-info">
                <div className="aa-client-name">{selectedClient.name || "—"}</div>
                <div className="aa-client-detail">{fmtPhone(selectedClient.phone)}</div>
                {selectedClient.address && (
                  <div className="aa-client-detail aa-client-addr">{selectedClient.address}</div>
                )}
              </div>
            </div>

            {/* Context toggles */}
            <div className="aa-section">
              <div className="aa-section-label">Include in context</div>
              <div className="aa-flags">
                {Object.entries(FLAG_LABELS).map(([key, label]) => (
                  <label key={key} className="aa-flag-row">
                    <input
                      type="checkbox"
                      checked={contextFlags[key]}
                      onChange={() =>
                        setContextFlags((prev) => ({ ...prev, [key]: !prev[key] }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <button
                className="aa-load-btn"
                onClick={handleLoadContext}
                disabled={contextLoading || !selectedClient.uid}
              >
                {contextLoading ? (
                  <><span className="aa-btn-spinner" /> Loading context…</>
                ) : contextLoaded ? (
                  "↺ Reload Context"
                ) : (
                  "Load Context"
                )}
              </button>
            </div>

            {/* Stats (post-load) */}
            {contextLoaded && stats && summary && (
              <div className="aa-section">
                <div className="aa-section-label">Context loaded</div>

                {summary.claimNumbers?.length > 0 && (
                  <div className="aa-stat-row">
                    <span className="aa-stat-label">Claim #</span>
                    <span className="aa-stat-val">{summary.claimNumbers[0]}</span>
                  </div>
                )}

                <div className="aa-progress-section">
                  <div className="aa-progress-label">Mitigation</div>
                  <div className="aa-progress-bar-wrap">
                    <div
                      className="aa-progress-bar"
                      style={{
                        width: `${Math.max(0, ((summary.mitigationStep + 1) / 5) * 100)}%`,
                        background: "#2563eb",
                      }}
                    />
                  </div>
                  <div className="aa-progress-text">{mitLabel}</div>

                  <div className="aa-progress-label" style={{ marginTop: 8 }}>Construction</div>
                  <div className="aa-progress-bar-wrap">
                    <div
                      className="aa-progress-bar"
                      style={{
                        width: `${Math.max(0, ((summary.constructionStep + 1) / 4) * 100)}%`,
                        background: "#16a34a",
                      }}
                    />
                  </div>
                  <div className="aa-progress-text">{conLabel}</div>
                </div>

                <div className="aa-stats-grid">
                  <div className="aa-stat-chip">
                    <div className="aa-stat-chip-val">{stats.pendingTodos ?? 0}</div>
                    <div className="aa-stat-chip-lbl">Pending tasks</div>
                  </div>
                  <div className="aa-stat-chip">
                    <div className="aa-stat-chip-val">{stats.documentCount ?? 0}</div>
                    <div className="aa-stat-chip-lbl">Documents</div>
                  </div>
                  <div className="aa-stat-chip">
                    <div className="aa-stat-chip-val">{stats.selectionCount ?? 0}</div>
                    <div className="aa-stat-chip-lbl">Selections</div>
                  </div>
                  <div className="aa-stat-chip">
                    <div className="aa-stat-chip-val">{stats.photoCount ?? 0}</div>
                    <div className="aa-stat-chip-lbl">Photos</div>
                  </div>
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
                    {summary.adjuster.company && (
                      <div className="aa-adjuster-detail">{summary.adjuster.company}</div>
                    )}
                  </div>
                )}

                {messages.length > 0 && (
                  <button
                    className="aa-clear-btn"
                    onClick={() => { setMessages([]); setStreamError(""); }}
                  >
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
        {/* Welcome / empty state */}
        {!selectedClient && (
          <div className="aa-empty-state">
            <div className="aa-empty-orb" />
            <h2 className="aa-empty-title">AI Claim Analysis</h2>
            <p className="aa-empty-desc">
              Select a client from the left panel, load their context, and ask anything
              about their claim — documents, photos, budget, tasks, and more.
            </p>
            <div className="aa-empty-chips">
              {QUICK_PROMPTS.map((q) => (
                <div key={q.label} className="aa-empty-chip">
                  <span>{q.icon}</span> {q.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedClient && !contextLoaded && !contextLoading && (
          <div className="aa-empty-state">
            <div className="aa-empty-icon">📂</div>
            <h2 className="aa-empty-title">{selectedClient.name || "Client selected"}</h2>
            <p className="aa-empty-desc">
              Click <strong>Load Context</strong> to gather this client's full case file —
              claim info, todos, documents, selections, budget, photos, and activity.
            </p>
          </div>
        )}

        {contextLoading && (
          <div className="aa-empty-state">
            <div className="aa-loading-ring" />
            <p className="aa-empty-desc">Loading client context…</p>
          </div>
        )}

        {/* Chat messages */}
        {contextLoaded && messages.length === 0 && !streaming && (
          <div className="aa-welcome">
            <div className="aa-welcome-header">
              <span className="aa-welcome-icon">✓</span>
              <span>Context loaded for <strong>{summary?.name}</strong></span>
            </div>
            <p className="aa-welcome-hint">Ask anything or pick a quick prompt:</p>
            <div className="aa-quick-prompts">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  className="aa-quick-btn"
                  onClick={() => handleQuickPrompt(q)}
                >
                  <span className="aa-quick-icon">{q.icon}</span>
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="aa-messages">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`aa-message aa-message--${msg.role}${msg.error ? " aa-message--error" : ""}${msg.streaming ? " aa-message--streaming" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className={`aa-ai-orb${msg.streaming ? " aa-ai-orb--active" : ""}`} />
                )}
                <div className="aa-message-bubble">
                  {msg.role === "assistant" ? (
                    <>
                      {msg.content ? <MarkdownMessage text={msg.content} /> : null}
                      {msg.streaming && !msg.content && <ThinkingState />}
                      {msg.streaming && msg.content && (
                        <span className="aa-cursor">▋</span>
                      )}
                    </>
                  ) : msg.label ? (
                    <div className="aa-action-badge">{msg.label}</div>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        )}

        {/* Error banner */}
        {streamError && (
          <div className="aa-error-banner">
            {streamError}
          </div>
        )}

        {/* Input area */}
        {contextLoaded && (
          <div className="aa-input-area">
            {/* Input card for prompts that need user input */}
            {activeQuickPrompt && (
              <div className="aa-quick-input-card">
                <div className="aa-quick-input-header">
                  <span className="aa-quick-input-icon">{activeQuickPrompt.icon}</span>
                  <span className="aa-quick-input-title">{activeQuickPrompt.label}</span>
                  <button
                    className="aa-quick-input-cancel"
                    onClick={() => setActiveQuickPrompt(null)}
                  >
                    ✕
                  </button>
                </div>
                <label className="aa-quick-input-label">{activeQuickPrompt.inputLabel}</label>
                <textarea
                  className="aa-quick-input-textarea"
                  placeholder={activeQuickPrompt.inputPlaceholder}
                  rows={activeQuickPrompt.inputRows || 2}
                  value={quickInputText}
                  onChange={(e) => setQuickInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && activeQuickPrompt.inputRows === 1) {
                      e.preventDefault();
                      handleQuickInputSubmit();
                    }
                  }}
                  autoFocus
                />
                <div className="aa-quick-input-actions">
                  <button
                    className="aa-quick-input-submit"
                    onClick={handleQuickInputSubmit}
                    disabled={!quickInputText.trim()}
                  >
                    Send to Claude ↑
                  </button>
                </div>
              </div>
            )}

            {messages.length > 0 && !streaming && !activeQuickPrompt && (
              <div className="aa-quick-bar">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q.label}
                    className="aa-quick-pill"
                    onClick={() => handleQuickPrompt(q)}
                  >
                    {q.icon} {q.label}
                  </button>
                ))}
              </div>
            )}
            <div className="aa-input-row">
              <textarea
                ref={inputRef}
                className="aa-textarea"
                placeholder={streaming ? "Claude is thinking…" : "Ask about this client's claim…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                rows={1}
              />
              <button
                className="aa-send-btn"
                onClick={() => handleSend()}
                disabled={!input.trim() || streaming}
              >
                {streaming ? <span className="aa-btn-spinner aa-btn-spinner--dark" /> : "↑"}
              </button>
            </div>
            <div className="aa-input-hint">
              Enter to send · Shift+Enter for new line
              {contextFlags.photos && clientContext?.photos?.length > 0 && (
                <span className="aa-photo-hint"> · {clientContext.stats?.photoCount} photos included</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

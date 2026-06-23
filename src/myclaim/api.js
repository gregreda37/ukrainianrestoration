import { auth } from '../firebase'

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000'

async function request(path, options = {}) {
  const user = auth.currentUser
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (user) {
    const token = await user.getIdToken()
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  get:  (path)        => request(path, { method: 'GET' }),
  post: (path, body)  => request(path, { method: 'POST', body: JSON.stringify(body) }),

  jobs: {
    getStatus:    (uid) => request(`/jobs/get-status?uid=${uid}`, { method: 'GET' }),
    updateStatus: (body) => request('/jobs/update-status', { method: 'POST', body: JSON.stringify(body) }),
  },

  claimChatbot: {
    processDocument: (body) => request('/claim-chatbot/process-document', { method: 'POST', body: JSON.stringify(body) }),
    ask:             (body) => request('/claim-chatbot/ask',              { method: 'POST', body: JSON.stringify(body) }),
    extractReport:   (body) => request('/claim-chatbot/extract-report',   { method: 'POST', body: JSON.stringify(body) }),
  },

  companyChatbot: {
    ask: (body) => request('/company-chatbot/ask-chatbot', { method: 'POST', body: JSON.stringify(body) }),
  },

  drive: {
    status:     (orgId)  => request(`/integrations/google-drive/status?orgId=${orgId}`, { method: 'GET' }),
    connect:    (orgId)  => request(`/integrations/google-drive/auth?orgId=${orgId}`, { method: 'GET' }),
    disconnect: (body)   => request('/integrations/google-drive/disconnect', { method: 'POST', body: JSON.stringify(body) }),
  },

  sms: {
    notify: (body) => request('/sms/notify', { method: 'POST', body: JSON.stringify(body) }),
  },
}

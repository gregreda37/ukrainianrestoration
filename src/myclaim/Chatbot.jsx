import { useState, useRef, useEffect } from 'react'
import { api } from './api'
import { useAuth } from './useAuth'

export default function Chatbot() {
  const { user } = useAuth()
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I can answer questions about your claim documents. Upload a document first, then ask me anything.' },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setSending(true)
    try {
      const res = await api.claimChatbot.ask({ uid: user.uid, question: text })
      setMessages(prev => [...prev, { role: 'assistant', text: res.answer || res.response || JSON.stringify(res) }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}`, isError: true }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mc-page mc-page--chat">
      <div className="mc-page__hd">
        <h1>AI Assistant</h1>
        <p className="mc-muted">Powered by Azure OpenAI · asks questions about your claim documents</p>
      </div>

      <div className="mc-chat">
        <div className="mc-chat__messages">
          {messages.map((msg, i) => (
            <div key={i} className={`mc-msg mc-msg--${msg.role}${msg.isError ? ' mc-msg--error' : ''}`}>
              <div className="mc-msg__bubble">{msg.text}</div>
            </div>
          ))}
          {sending && (
            <div className="mc-msg mc-msg--assistant">
              <div className="mc-msg__bubble mc-msg__bubble--typing">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form className="mc-chat__input" onSubmit={handleSend}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your claim…"
            disabled={sending}
          />
          <button className="mc-btn mc-btn--primary" type="submit" disabled={!input.trim() || sending}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

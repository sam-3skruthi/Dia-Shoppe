import { useState, useRef, useEffect } from 'react'
import { askAssistant } from '../../lib/adminAssistant'
import { FiMessageSquare, FiX, FiSend, FiZap, FiCpu } from 'react-icons/fi'

/*
  Floating AI co-pilot for staff, available on every admin page. Ask it things
  like "what needs my attention?" or "is anything wrong?" — it reads the live
  store health and answers (Claude when credits are available, a rule-based
  summary otherwise). The same model powers the WhatsApp assistant.
*/

const SUGGESTIONS = [
  'What needs my attention today?',
  'Is anything wrong right now?',
  'Which products are low on stock?',
]

export default function AdminAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role: 'user'|'bot', text, ai? }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    const res = await askAssistant(q)
    setBusy(false)
    if (res.error) {
      setMessages((m) => [...m, { role: 'bot', text: `Sorry — I couldn't reach the assistant (${res.error}).` }])
    } else {
      setMessages((m) => [...m, { role: 'bot', text: res.answer, ai: res.ai }])
    }
  }

  return (
    <>
      {/* launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-primary-700 text-white shadow-lg shadow-primary-900/30 flex items-center justify-center hover:bg-primary-800 transition-colors"
        aria-label="Open assistant"
      >
        {open ? <FiX size={22} /> : <FiMessageSquare size={22} />}
      </button>

      {/* panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-40 w-[min(92vw,380px)] bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden" style={{ height: 'min(70vh, 560px)' }}>
          {/* header */}
          <div className="bg-gradient-to-r from-ink-950 via-primary-950 to-primary-900 text-white px-4 py-3 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><FiZap size={16} className="text-secondary-300" /></span>
            <div className="leading-tight">
              <div className="font-semibold text-sm">Store Assistant</div>
              <div className="text-[11px] text-blue-100/70">Ask about orders, stock, alerts</div>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-center pt-6">
                <FiCpu size={26} className="mx-auto text-gray-300" />
                <p className="text-sm text-gray-500 mt-2 mb-3">Ask me anything about your store.</p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="block w-full text-left text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:border-primary-300 hover:text-primary-700">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-primary-700 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-700 rounded-bl-none'
                }`}>
                  {m.text}
                  {m.role === 'bot' && m.ai === false && (
                    <span className="block mt-1.5 text-[10px] text-gray-400">Live summary · add AI credits for smarter answers</span>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-none px-3 py-2 text-sm text-gray-400">Thinking…</div>
              </div>
            )}
          </div>

          {/* input */}
          <div className="p-3 border-t border-gray-100 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask the assistant…"
              className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-secondary-400"
            />
            <button onClick={() => send()} disabled={busy || !input.trim()} className="w-9 h-9 rounded-full bg-primary-700 text-white flex items-center justify-center hover:bg-primary-800 disabled:opacity-50 shrink-0">
              <FiSend size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

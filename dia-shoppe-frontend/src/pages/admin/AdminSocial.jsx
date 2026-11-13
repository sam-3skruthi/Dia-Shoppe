import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchSocialStatus, fetchSocialInbox, replyToSocial, connectUrl } from '../../lib/adminSocial'
import { FiSend, FiCheckCircle, FiExternalLink, FiInbox, FiMessageSquare } from 'react-icons/fi'
import { FaInstagram, FaFacebookF } from 'react-icons/fa'

/*
  Instagram / Facebook management — connection status + a unified inbox of
  comments and DMs, with inline replies. Real data flows once the Meta app is
  verified and the accounts are connected (see the Connect buttons).
*/

const PLATFORMS = {
  instagram: { label: 'Instagram', icon: FaInstagram, color: '#0277BD', bg: 'from-[#90E0EF] via-[#00B4D8] to-[#02629C]' },
  facebook: { label: 'Facebook', icon: FaFacebookF, color: '#0277BD', bg: 'from-[#0277BD] to-[#0277BD]' },
}

function ConnectCard({ platform, account }) {
  const meta = PLATFORMS[platform]
  const connected = account?.connected
  const url = connectUrl(platform)
  return (
    <div className={`rounded-2xl p-5 text-white bg-gradient-to-br ${meta.bg} shadow-sm`}>
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center"><meta.icon size={22} /></span>
        <div className="flex-1">
          <div className="font-semibold">{meta.label}</div>
          <div className="text-xs text-white/80">
            {connected ? `Connected · ${account.account_name || 'account'}` : 'Not connected'}
          </div>
        </div>
        {connected && <FiCheckCircle size={20} />}
      </div>
      {!connected && (
        <a
          href={url || undefined}
          onClick={(e) => { if (!url) { e.preventDefault(); alert('Connecting requires the Meta app to be verified first (in progress). Set VITE_META_APP_ID once approved.') } }}
          className="mt-4 inline-flex items-center gap-1.5 bg-white/95 text-ink-900 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-white"
        >
          Connect {meta.label} <FiExternalLink size={13} />
        </a>
      )}
    </div>
  )
}

function InboxItem({ msg, onReply }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(msg.replied)
  const meta = PLATFORMS[msg.platform]

  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    const { error } = await onReply(msg.id, text)
    setSending(false)
    if (!error) { setDone(true); setText('') }
  }

  return (
    <div className="border-b border-gray-50 last:border-0 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ backgroundColor: meta.color }}>
          <meta.icon size={12} />
        </span>
        <span className="font-medium text-ink-900 text-sm">{msg.from_name || 'Someone'}</span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{msg.kind}</span>
        <span className="text-xs text-gray-400 ml-auto">{new Date(msg.received_at).toLocaleString('en-IN')}</span>
      </div>
      <p className="text-sm text-gray-700 ml-8">{msg.text}</p>
      {done ? (
        <p className="ml-8 mt-2 text-xs text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12} /> Replied{msg.reply_text ? `: ${msg.reply_text}` : ''}</p>
      ) : (
        <div className="ml-8 mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
          <button onClick={send} disabled={sending || !text.trim()}
            className="inline-flex items-center gap-1 bg-secondary-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-secondary-600 disabled:opacity-50">
            <FiSend size={13} /> {sending ? '…' : 'Reply'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AdminSocial() {
  const [accounts, setAccounts] = useState({})
  const [messages, setMessages] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchSocialStatus().then((r) => !r.error && setAccounts(r.accounts))
  }, [])
  useEffect(() => {
    setLoading(true)
    fetchSocialInbox(filter).then((r) => {
      if (r.error) setError(r.error); else setMessages(r.messages)
      setLoading(false)
    })
  }, [filter])

  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
  ]

  return (
    <AdminLayout title="Social" subtitle="Instagram & Facebook — comments, messages and replies in one place">
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">{error}</div>}

      {/* connection cards */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <ConnectCard platform="instagram" account={accounts.instagram} />
        <ConnectCard platform="facebook" account={accounts.facebook} />
      </div>

      {/* inbox */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-ink-900 flex items-center gap-2"><FiInbox size={17} className="text-secondary-500" /> Inbox</h2>
          <div className="flex gap-2">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${filter === t.key ? 'bg-primary-700 text-white' : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 py-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <FiMessageSquare size={30} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500 font-medium">No messages yet</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              Once your Instagram / Facebook accounts are connected, comments and DMs land here in real time
              for staff to reply to — with the AI able to draft answers.
            </p>
          </div>
        ) : (
          <div>{messages.map((m) => <InboxItem key={m.id} msg={m} onReply={replyToSocial} />)}</div>
        )}
      </div>
    </AdminLayout>
  )
}

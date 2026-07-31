import { useState, useRef, useEffect } from 'react';
import { sendChat } from '../api.js';

// Floating conversational assistant. Talks to POST /api/chat, which runs
// Gemini over the ad data (read-only) and answers in plain language.
const SUGGESTIONS = [
  'How am I doing this month?',
  'Which campaigns should I fix?',
  'May sinasayang ba akong ad spend?',
  'What should I do to lower my ACoS?',
];

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setError(null);
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    try {
      const { reply } = await sendChat(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!open) {
    return (
      <button
        className="btn primary"
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 50, borderRadius: 24, padding: '10px 18px', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}
      >
        💬 Ask the AI
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 50,
        width: 380, maxWidth: 'calc(100vw - 40px)', height: 520, maxHeight: 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', color: 'var(--text-1)',
        border: '1px solid var(--border)', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,.28)', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ fontSize: 14 }}>Ads AI Assistant</strong>
        <button className="btn" onClick={() => setOpen(false)} style={{ padding: '2px 10px' }}>✕</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            <p style={{ marginTop: 0 }}>Ask me about your Sponsored Products performance — I read your data and give recommendations.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn" onClick={() => send(s)} style={{ fontSize: 12, padding: '6px 10px' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'var(--series-sales)' : 'color-mix(in srgb, var(--text-1) 8%, transparent)',
              color: m.role === 'user' ? '#fff' : 'var(--text-1)',
              padding: '8px 12px', borderRadius: 12,
              fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {m.content}
          </div>
        ))}

        {busy && (
          <div style={{ alignSelf: 'flex-start', fontSize: 13, opacity: 0.7, fontStyle: 'italic' }}>
            Thinking…
          </div>
        )}
        {error && (
          <div className="error" style={{ fontSize: 12 }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your ads…"
          rows={1}
          style={{ flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)', font: 'inherit', fontSize: 13 }}
        />
        <button className="btn primary" onClick={() => send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

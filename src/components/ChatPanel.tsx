import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, X } from 'lucide-react';
import type { ChatMessage } from '../../shared/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  currentPlayerId: string;
  onSendMessage: (text: string) => void;
  onClose?: () => void;
  variant: 'mobile-sheet' | 'sidebar';
}

export function ChatPanel({
  messages,
  currentPlayerId,
  onSendMessage,
  onClose,
  variant,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setDraft('');
  };

  const containerClass =
    variant === 'mobile-sheet'
      ? 'flex h-full w-full flex-col rounded-t-3xl border-t border-white/20 bg-slate-950/92 shadow-2xl backdrop-blur-xl'
      : 'flex h-full w-full flex-col rounded-2xl border border-white/15 bg-slate-900/65 backdrop-blur-md';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="font-display text-sm font-semibold text-white">
          Чат комнаты
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть чат"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm"
      >
        {messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            Обсуждайте варианты слов или делитесь подсказками
          </p>
        ) : (
          messages.map((msg) => {
            if (msg.isSystem) {
              return (
                <p
                  key={msg.id}
                  className="text-center text-xs text-slate-400 py-0.5"
                >
                  {msg.text}
                </p>
              );
            }

            const isMine = msg.playerId === currentPlayerId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                <span
                  className={`mb-0.5 px-1 text-[11px] font-medium ${
                    isMine ? 'text-amber-300/85' : 'text-amber-200/90'
                  }`}
                >
                  {isMine ? `${msg.nickname} (вы)` : msg.nickname}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words sm:text-sm ${
                    isMine
                      ? 'bg-amber-400 text-slate-950 font-medium'
                      : 'bg-white/12 text-slate-100'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-white/10 p-2.5"
      >
        <input
          type="text"
          maxLength={240}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Сообщение..."
          className="h-11 flex-1 rounded-xl border border-white/15 bg-slate-900/80 px-3.5 text-sm text-white placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Отправить сообщение"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

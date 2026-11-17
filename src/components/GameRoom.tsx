import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BookmarkCheck,
  Check,
  Copy,
  Crown,
  Hammer,
  Lightbulb,
  LogOut,
  MessageCircle,
  Pencil,
  RefreshCw,
  Shuffle,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  WORD_TOPICS,
  type ChatMessage,
  type Difficulty,
  type RoomStatePayload,
  type WordTopic,
} from '../../shared/types';
import { soundEngine } from '../utils/sound';
import { BonusWordsModal } from './BonusWordsModal';
import { ChatPanel } from './ChatPanel';
import { CrosswordGrid } from './CrosswordGrid';
import { LetterWheel } from './LetterWheel';
import { PlayersList } from './PlayersList';
import { VictoryModal } from './VictoryModal';

interface GameRoomProps {
  room: RoomStatePayload;
  playerId: string;
  personalScore: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onLeaveRoom: () => void;
  onRenameNickname: (nickname: string) => Promise<{ ok: boolean; error?: string }>;
  onSubmitWord: (word: string) => Promise<{
    ok: boolean;
    status: string;
    message?: string;
    pointsEarned?: number;
  }>;
  onUseHint: (
    type: 'lightbulb' | 'hammer',
    row?: number,
    col?: number
  ) => Promise<{ ok: boolean; error?: string }>;
  onNextLevel: (
    difficulty: Difficulty,
    topic: WordTopic
  ) => Promise<{ ok: boolean; error?: string }>;
  onRecreateLevel: (
    difficulty: Difficulty,
    topic: WordTopic
  ) => Promise<{ ok: boolean; error?: string }>;
  onSendChat: (text: string) => void;
  incomingToastMessages: ChatMessage[];
  gridNotice: string | null;
}

const LIGHTBULB_COST = 50;
const HAMMER_COST = 75;

const DIFF_LABELS: Record<Difficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
};

export function GameRoom({
  room,
  playerId,
  personalScore,
  soundEnabled,
  onToggleSound,
  onLeaveRoom,
  onRenameNickname,
  onSubmitWord,
  onUseHint,
  onNextLevel,
  onRecreateLevel,
  onSendChat,
  incomingToastMessages,
  gridNotice,
}: GameRoomProps) {
  // Local shuffled order of wheel letters (resets whenever level/wheel changes)
  const wheelKey = `${room.levelNumber}-${room.wheelLetters.join('')}`;
  const [localLetters, setLocalLetters] = useState<string[]>(room.wheelLetters);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  useEffect(() => {
    setLocalLetters(room.wheelLetters);
    setSelectedIndices([]);
  }, [wheelKey]);

  const [previewFeedback, setPreviewFeedback] = useState<{
    text: string;
    tone: 'error' | 'bonus' | 'ok';
    shake: boolean;
  } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hammerMode, setHammerMode] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [showPlayersSheet, setShowPlayersSheet] = useState(false);
  const [showRecreateModal, setShowRecreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [hostDiffChoice, setHostDiffChoice] = useState<Difficulty>(room.difficulty);
  const [hostTopicChoice, setHostTopicChoice] = useState<WordTopic>(room.topic);

  useEffect(() => {
    setHostDiffChoice(room.difficulty);
    setHostTopicChoice(room.topic);
    setHammerMode(false);
  }, [room.levelNumber, room.difficulty, room.topic, room.wheelLetters]);

  const prevMsgCountRef = useRef(room.messages.length);
  useEffect(() => {
    if (room.messages.length > prevMsgCountRef.current) {
      const added = room.messages.slice(prevMsgCountRef.current);
      const fromOthers = added.filter(
        (m) => !m.isSystem && m.playerId !== playerId
      ).length;
      if (fromOthers > 0 && !mobileChatOpen) {
        setUnreadCount((c) => c + fromOthers);
      }
    }
    prevMsgCountRef.current = room.messages.length;
  }, [room.messages, playerId, mobileChatOpen]);

  const me = useMemo(
    () => room.players.find((p) => p.playerId === playerId),
    [room.players, playerId]
  );
  const isHost = Boolean(me?.isHost);

  const showFeedback = useCallback(
    (text: string, tone: 'error' | 'bonus' | 'ok', shake = false) => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      setPreviewFeedback({ text, tone, shake });
      feedbackTimerRef.current = setTimeout(() => {
        setPreviewFeedback(null);
      }, 1500);
    },
    []
  );

  const handleShuffle = useCallback(() => {
    setSelectedIndices([]);
    setLocalLetters((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    });
    soundEngine.playShuffle();
  }, []);

  const submitIndices = useCallback(
    async (indices: number[]) => {
      const word = indices.map((i) => localLetters[i] ?? '').join('');
      setSelectedIndices([]);
      if (word.length < 3) {
        if (word.length >= 2) {
          soundEngine.playInvalid();
          showFeedback('Минимум 3 буквы', 'error', true);
        }
        return;
      }

      const res = await onSubmitWord(word);
      if (res.status === 'solved') {
        soundEngine.playWordSolved();
        showFeedback(`${word.toUpperCase()} +${res.pointsEarned ?? 0}`, 'ok', false);
      } else if (res.status === 'bonus') {
        soundEngine.playBonusWord();
        showFeedback(res.message ?? 'Бонусное слово!', 'bonus', false);
      } else {
        soundEngine.playInvalid();
        showFeedback(res.message ?? 'Нет такого слова', 'error', true);
      }
    },
    [localLetters, onSubmitWord, showFeedback]
  );

  // Desktop keyboard support (А-Я, Ё, Backspace, Enter, Space)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Do not intercept typing in inputs/textareas (e.g. chat)
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || room.roundComplete) return;
      if (showBonusModal || showPlayersSheet || showRenameModal || showRecreateModal) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        setSelectedIndices((prev) => prev.slice(0, -1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndices.length > 0) {
          submitIndices(selectedIndices);
        }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        handleShuffle();
        return;
      }
      if (e.key === 'Escape' && hammerMode) {
        setHammerMode(false);
        return;
      }

      const rawCh = e.key.toUpperCase();
      // Treat Е and Ё identically
      const ch = rawCh === 'Ё' ? 'Е' : rawCh;
      if (/^[А-Я]$/.test(ch)) {
        const availIdx = localLetters.findIndex(
          (l, idx) => (l === 'Ё' ? 'Е' : l) === ch && !selectedIndices.includes(idx)
        );
        if (availIdx !== -1) {
          const next = [...selectedIndices, availIdx];
          setSelectedIndices(next);
          soundEngine.playLetterSelect(next.length - 1);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    localLetters,
    selectedIndices,
    room.roundComplete,
    showBonusModal,
    showPlayersSheet,
    showRenameModal,
    showRecreateModal,
    hammerMode,
    submitIndices,
    handleShuffle,
  ]);

  const handleCopyInvite = async () => {
    const inviteUrl = `${window.location.origin}/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Fallback: copy code or ignore
    }
  };

  const handleLightbulb = async () => {
    if (room.roundComplete) return;
    setHammerMode(false);
    const res = await onUseHint('lightbulb');
    if (res.ok) {
      soundEngine.playHint();
    } else if (res.error) {
      soundEngine.playInvalid();
      showFeedback(res.error, 'error', true);
    }
  };

  const handleToggleHammer = () => {
    if (room.roundComplete) return;
    if (!hammerMode && room.sharedHints === 0 && personalScore < HAMMER_COST) {
      soundEngine.playInvalid();
      showFeedback(`Нужно ${HAMMER_COST} очков`, 'error', true);
      return;
    }
    setHammerMode((v) => !v);
  };

  const handleSelectHammerCell = async (row: number, col: number) => {
    setHammerMode(false);
    const res = await onUseHint('hammer', row, col);
    if (res.ok) {
      soundEngine.playHint();
    } else if (res.error) {
      soundEngine.playInvalid();
      showFeedback(res.error, 'error', true);
    }
  };

  const handleNextLevelTrigger = async (diff: Difficulty, topic: WordTopic) => {
    setLoadingNext(true);
    await onNextLevel(diff, topic);
    setLoadingNext(false);
  };

  const handleRecreateLevelTrigger = async (diff: Difficulty, topic: WordTopic) => {
    setLoadingNext(true);
    const res = await onRecreateLevel(diff, topic);
    setLoadingNext(false);
    if (!res.ok && res.error) {
      showFeedback(res.error, 'error', true);
    }
  };

  const openRenameModal = () => {
    setRenameDraft(me?.nickname ?? '');
    setRenameError(null);
    setShowRenameModal(true);
  };

  const handleSubmitRename = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError('Введите имя от 1 до 20 символов');
      return;
    }
    setRenaming(true);
    const res = await onRenameNickname(trimmed);
    setRenaming(false);
    if (res.ok) {
      setShowRenameModal(false);
    } else {
      setRenameError(res.error ?? 'Не удалось сменить имя');
    }
  };

  const activeWord = selectedIndices.map((i) => localLetters[i] ?? '').join('');
  const lightbulbPaid = room.sharedHints === 0;
  const hammerPaid = room.sharedHints === 0;
  const currentTopicLabel =
    WORD_TOPICS.find((t) => t.id === room.topic)?.label ?? 'Все слова';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Compact Top Bar (<= 10% mobile height) */}
      <header className="z-30 flex h-13 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-slate-950/60 px-3 backdrop-blur-md sm:px-5">
        {/* Left: Room Invite Code + Online Players */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleCopyInvite}
            title="Скопировать ссылку-приглашение"
            className="flex h-10 items-center gap-1.5 rounded-xl bg-white/10 px-2.5 font-mono text-xs font-bold tracking-wider text-white transition hover:bg-white/20 whitespace-nowrap"
          >
            <span>{room.code}</span>
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-slate-300" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowPlayersSheet(true)}
            aria-label="Список игроков в комнате"
            className="flex h-10 items-center gap-1.5 rounded-xl bg-white/10 px-2.5 text-xs font-semibold text-slate-100 transition hover:bg-white/20 lg:hidden whitespace-nowrap tabular-nums"
          >
            <Users className="h-3.5 w-3.5 text-amber-300" />
            <span>
              {room.players.length}/4
            </span>
          </button>

          <div className="hidden lg:flex items-center gap-2 pl-2 text-xs text-slate-300 whitespace-nowrap">
            <span>Уровень #{room.levelNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{currentTopicLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{DIFF_LABELS[room.difficulty]}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              Слова: {room.wordsSolved}/{room.wordsTotal}
            </span>
          </div>
        </div>

        {/* Right: Hints + Nickname + Score + Recreate(mobile host) + Sound + Leave */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            title="Общие бесплатные подсказки комнаты"
            className="flex items-center gap-1 px-1.5 text-xs font-semibold text-amber-200 tabular-nums whitespace-nowrap"
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
            <span>{room.sharedHints}</span>
          </div>

          {me && (
            <button
              type="button"
              onClick={openRenameModal}
              title="Нажмите, чтобы сменить ник"
              aria-label="Сменить ник"
              className="flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-white/8 px-2 text-xs font-semibold text-amber-200 transition hover:bg-white/15"
            >
              <span className="max-w-[78px] sm:max-w-[140px] truncate">
                {me.nickname}
              </span>
              <Pencil className="h-3 w-3 shrink-0 text-slate-300" />
            </button>
          )}

          <div
            title="Ваши личные очки"
            className="flex items-center gap-1 px-1.5 text-xs font-semibold text-white tabular-nums whitespace-nowrap"
          >
            <Trophy className="h-3.5 w-3.5 text-amber-300" />
            <span>{personalScore}</span>
          </div>

          {isHost && (
            <button
              type="button"
              onClick={() => setShowRecreateModal(true)}
              aria-label="Пересоздать уровень или сменить тему"
              title="Пересоздать уровень / тема"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/15 lg:hidden"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Выключить звук' : 'Включить звук'}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/15"
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4 text-slate-400" />
            )}
          </button>

          <button
            type="button"
            onClick={onLeaveRoom}
            aria-label="Выйти из комнаты"
            title="Выйти в меню"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Always-visible Players Nicknames Strip on Mobile & Tablet */}
      <div
        role="region"
        aria-label="Игроки в комнате"
        className="z-20 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-slate-950/40 px-3 py-1.5 backdrop-blur-sm lg:hidden"
      >
        {room.players.map((p) => {
          const isMe = p.playerId === playerId;
          return (
            <button
              key={p.playerId}
              type="button"
              onClick={() => setShowPlayersSheet(true)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                isMe
                  ? 'border-amber-300/40 bg-amber-400/15 text-amber-100'
                  : 'border-white/10 bg-white/8 text-slate-200 hover:bg-white/15'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  p.online ? 'bg-emerald-400' : 'bg-amber-400/70'
                }`}
              />
              {p.isHost && (
                <Crown className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
              )}
              <span className="max-w-[110px] truncate font-medium">
                {p.nickname}
                {isMe ? ' (вы)' : ''}
              </span>
              <span className="text-[11px] text-slate-400 tabular-nums">
                {p.roundWordsFound}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Responsive Workspace */}
      <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 lg:grid-cols-12 lg:gap-6 lg:p-4">
        {/* Game Stage (Full mobile view / 8 cols on desktop) */}
        <div className="relative flex min-h-0 flex-col lg:col-span-8">
          {/* Upper-Center: Crossword Grid (~48% height on mobile) */}
          <div className="relative min-h-0 flex-1 pt-2">
            <CrosswordGrid
              rows={room.grid.rows}
              cols={room.grid.cols}
              cells={room.grid.cells}
              hammerMode={hammerMode}
              onCancelHammer={() => setHammerMode(false)}
              onSelectHammerCell={handleSelectHammerCell}
              gridNotice={gridNotice}
            />

            {/* Closed-Chat Floating Toasts (mobile & desktop non-blocking) */}
            {!mobileChatOpen && incomingToastMessages.length > 0 && (
              <div className="pointer-events-none absolute bottom-1 left-3 right-3 z-20 flex flex-col items-start gap-1 lg:hidden">
                {incomingToastMessages.slice(-2).map((msg) => (
                  <div
                    key={msg.id}
                    className="max-w-[85%] truncate rounded-xl border border-white/15 bg-slate-950/85 px-3 py-1.5 text-xs text-slate-100 shadow-lg backdrop-blur-md"
                  >
                    <span className="font-semibold text-amber-300">
                      {msg.nickname}:{' '}
                    </span>
                    <span>{msg.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Word Preview Strip */}
          <div className="flex h-11 shrink-0 items-center justify-center px-4">
            {activeWord ? (
              <div className="rounded-xl bg-amber-400 px-4 py-1 font-display text-lg font-bold tracking-widest text-slate-950 shadow-md">
                {activeWord}
              </div>
            ) : previewFeedback ? (
              <div
                className={`rounded-xl px-4 py-1 text-xs font-semibold shadow-md ${
                  previewFeedback.shake ? 'animate-shake ' : ''
                }${
                  previewFeedback.tone === 'error'
                    ? 'bg-rose-500/85 text-white'
                    : previewFeedback.tone === 'bonus'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-emerald-500/90 text-white'
                }`}
              >
                {previewFeedback.text}
              </div>
            ) : (
              <p className="text-xs text-slate-300/75 tabular-nums">
                Слов: {room.wordsSolved}/{room.wordsTotal} · Проведите по буквам
              </p>
            )}
          </div>

          {/* Lower Zone: Letter Wheel + Action Buttons (~38-42% height on mobile) */}
          <div className="relative flex h-[40%] min-h-[225px] max-h-[300px] shrink-0 items-center justify-center px-3 pb-3 lg:h-[280px] lg:max-h-[290px]">
            {/* Left Side Buttons */}
            <div className="flex flex-col items-center gap-3 pr-2 sm:pr-5">
              <button
                type="button"
                onClick={handleShuffle}
                title="Перемешать буквы (Пробел)"
                aria-label="Перемешать буквы"
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-slate-900/70 text-slate-100 shadow-lg backdrop-blur-md transition hover:bg-slate-800/80 active:scale-95"
              >
                <Shuffle className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() => setShowBonusModal(true)}
                title="Найденные бонусные слова"
                aria-label="Бонусные слова"
                className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-slate-900/70 text-slate-100 shadow-lg backdrop-blur-md transition hover:bg-slate-800/80 active:scale-95"
              >
                <BookmarkCheck className="h-5 w-5 text-amber-300" />
                {room.bonusWords.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-950 tabular-nums">
                    {room.bonusWords.length}
                  </span>
                )}
              </button>
            </div>

            {/* Center Wheel */}
            <div className="h-full w-full max-w-[270px]">
              <LetterWheel
                letters={localLetters}
                selectedIndices={selectedIndices}
                onChangeSelection={setSelectedIndices}
                onSubmitSelection={submitIndices}
                disabled={room.roundComplete}
              />
            </div>

            {/* Right Side Buttons: Hints & Mobile Chat */}
            <div className="flex flex-col items-center gap-3 pl-2 sm:pl-5">
              <button
                type="button"
                onClick={handleLightbulb}
                title={
                  lightbulbPaid
                    ? `Открыть случайную букву (${LIGHTBULB_COST} очков)`
                    : 'Открыть случайную букву (бесплатно)'
                }
                aria-label="Подсказка: случайная буква"
                className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-slate-900/70 text-amber-300 shadow-lg backdrop-blur-md transition hover:bg-slate-800/80 active:scale-95"
              >
                <Lightbulb className="h-5 w-5" />
                <span className="absolute -bottom-1.5 rounded-md bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-200 tabular-nums border border-white/10">
                  {lightbulbPaid ? `${LIGHTBULB_COST}` : '1'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleHammer}
                title={
                  hammerPaid
                    ? `Выбрать клетку (${HAMMER_COST} очков)`
                    : 'Выбрать клетку (бесплатно)'
                }
                aria-label="Подсказка: молоточек (выбор клетки)"
                className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border shadow-lg backdrop-blur-md transition active:scale-95 ${
                  hammerMode
                    ? 'border-amber-300 bg-amber-400 text-slate-950'
                    : 'border-white/15 bg-slate-900/70 text-amber-300 hover:bg-slate-800/80'
                }`}
              >
                <Hammer className="h-5 w-5" />
                <span className="absolute -bottom-1.5 rounded-md bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-200 tabular-nums border border-white/10">
                  {hammerPaid ? `${HAMMER_COST}` : '1'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileChatOpen(true);
                  setUnreadCount(0);
                }}
                aria-label="Открыть чат"
                className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-slate-900/70 text-slate-100 shadow-lg backdrop-blur-md transition hover:bg-slate-800/80 active:scale-95 lg:hidden"
              >
                <MessageCircle className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-400 px-1 text-[11px] font-bold text-slate-950 tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Chat Overlay: Covers ONLY the lower area (wheel + controls), leaving Top Bar & Crossword Grid 100% visible */}
          {mobileChatOpen && (
            <div className="absolute bottom-0 left-0 right-0 z-40 h-[47%] min-h-[250px] max-h-[340px] lg:hidden">
              <ChatPanel
                variant="mobile-sheet"
                messages={room.messages}
                currentPlayerId={playerId}
                onSendMessage={onSendChat}
                onClose={() => setMobileChatOpen(false)}
              />
            </div>
          )}
        </div>

        {/* Desktop Right Sidebar (Players + Host Controls + Chat) */}
        <aside className="hidden lg:flex lg:col-span-4 lg:min-h-0 lg:flex-col lg:gap-4">
          <div className="rounded-2xl border border-white/15 bg-slate-900/65 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between pb-2">
              <h2 className="font-display text-sm font-semibold text-white">
                Игроки ({room.players.length}/4)
              </h2>
              <button
                type="button"
                onClick={openRenameModal}
                className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-white/20 whitespace-nowrap"
              >
                <Pencil className="h-3 w-3" />
                <span>Сменить ник</span>
              </button>
            </div>
            <PlayersList players={room.players} currentPlayerId={playerId} />

            {isHost && (
              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Уровень и тема (хост)</span>
                  <span className="text-slate-400">#{room.levelNumber}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    aria-label="Тема слов"
                    value={hostTopicChoice}
                    onChange={(e) =>
                      setHostTopicChoice(e.target.value as WordTopic)
                    }
                    className="h-9 rounded-lg border border-white/15 bg-slate-950/70 px-2 text-xs text-slate-100 focus:outline-none"
                  >
                    {WORD_TOPICS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Сложность нового уровня"
                    value={hostDiffChoice}
                    onChange={(e) =>
                      setHostDiffChoice(e.target.value as Difficulty)
                    }
                    className="h-9 rounded-lg border border-white/15 bg-slate-950/70 px-2 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="easy">Лёгкий</option>
                    <option value="medium">Средний</option>
                    <option value="hard">Сложный</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={loadingNext}
                  onClick={() =>
                    handleRecreateLevelTrigger(hostDiffChoice, hostTopicChoice)
                  }
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingNext ? 'animate-spin' : ''}`} />
                  <span>
                    {loadingNext ? 'Создаём сетку...' : 'Пересоздать уровень'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <ChatPanel
              variant="sidebar"
              messages={room.messages}
              currentPlayerId={playerId}
              onSendMessage={onSendChat}
            />
          </div>
        </aside>
      </div>

      {/* Mobile Players Drawer / Modal */}
      {showPlayersSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Участники комнаты"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4 lg:hidden"
          onClick={() => setShowPlayersSheet(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Игроки ({room.players.length}/4)
                </h2>
                <p className="text-xs text-slate-300">
                  Уровень #{room.levelNumber} · {currentTopicLabel} · {DIFF_LABELS[room.difficulty]}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowPlayersSheet(false);
                    openRenameModal();
                  }}
                  className="flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-xs font-medium text-amber-200 hover:bg-white/20"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Ник</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPlayersSheet(false)}
                  aria-label="Закрыть список игроков"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="py-2">
              <PlayersList players={room.players} currentPlayerId={playerId} />
            </div>

            {isHost && (
              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                <p className="text-xs font-medium text-slate-300">
                  Пересоздать уровень или сменить тему (хост)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Тема слов"
                    value={hostTopicChoice}
                    onChange={(e) =>
                      setHostTopicChoice(e.target.value as WordTopic)
                    }
                    className="h-11 rounded-xl border border-white/15 bg-slate-950/70 px-3 text-xs text-white"
                  >
                    {WORD_TOPICS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Сложность"
                    value={hostDiffChoice}
                    onChange={(e) =>
                      setHostDiffChoice(e.target.value as Difficulty)
                    }
                    className="h-11 rounded-xl border border-white/15 bg-slate-950/70 px-3 text-xs text-white"
                  >
                    <option value="easy">Лёгкий</option>
                    <option value="medium">Средний</option>
                    <option value="hard">Сложный</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={loadingNext}
                  onClick={async () => {
                    await handleRecreateLevelTrigger(
                      hostDiffChoice,
                      hostTopicChoice
                    );
                    setShowPlayersSheet(false);
                  }}
                  className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-4 text-sm font-bold text-slate-950 whitespace-nowrap disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingNext ? 'animate-spin' : ''}`} />
                  <span>
                    {loadingNext ? 'Создаём сетку...' : 'Пересоздать уровень'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rename Nickname Modal */}
      {showRenameModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Смена ника"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={() => setShowRenameModal(false)}
        >
          <form
            onSubmit={handleSubmitRename}
            className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="font-display text-base font-bold text-white">
                Сменить ник
              </h2>
              <button
                type="button"
                onClick={() => setShowRenameModal(false)}
                aria-label="Закрыть окно смены ника"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                type="text"
                maxLength={20}
                autoFocus
                value={renameDraft}
                onChange={(e) => {
                  setRenameDraft(e.target.value);
                  setRenameError(null);
                }}
                placeholder="Новое имя"
                className="h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-3.5 text-sm text-white placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
              />
              {renameError && (
                <p className="text-xs text-rose-300">{renameError}</p>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowRenameModal(false)}
                className="h-11 flex-1 rounded-xl border border-white/15 bg-white/10 text-sm font-semibold text-white hover:bg-white/15"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={!renameDraft.trim() || renaming}
                className="h-11 flex-1 rounded-xl bg-amber-400 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
              >
                {renaming ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile Host Recreate / Theme Modal */}
      {showRecreateModal && isHost && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Пересоздать уровень"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm lg:hidden"
          onClick={() => setShowRecreateModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="font-display text-base font-bold text-white">
                Пересоздать уровень #{room.levelNumber}
              </h2>
              <button
                type="button"
                onClick={() => setShowRecreateModal(false)}
                aria-label="Закрыть"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-300">
                  Тема слов и фона
                </p>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1">
                  {WORD_TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setHostTopicChoice(t.id)}
                      className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold transition truncate ${
                        hostTopicChoice === t.id
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-300">
                  Сложность
                </p>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map((diff) => (
                    <button
                      key={diff}
                      type="button"
                      onClick={() => setHostDiffChoice(diff)}
                      className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold transition ${
                        hostDiffChoice === diff
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {DIFF_LABELS[diff]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={loadingNext}
                onClick={async () => {
                  await handleRecreateLevelTrigger(
                    hostDiffChoice,
                    hostTopicChoice
                  );
                  setShowRecreateModal(false);
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loadingNext ? 'animate-spin' : ''}`} />
                <span>
                  {loadingNext ? 'Создаём сетку...' : 'Пересоздать уровень'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bonus Words Modal */}
      {showBonusModal && (
        <BonusWordsModal
          bonusWords={room.bonusWords}
          bonusPossibleCount={room.bonusPossibleCount}
          onClose={() => setShowBonusModal(false)}
        />
      )}

      {/* Victory Modal */}
      {room.roundComplete && (
        <VictoryModal
          levelNumber={room.levelNumber}
          currentDifficulty={room.difficulty}
          currentTopic={room.topic}
          players={room.players}
          currentPlayerId={playerId}
          bonusCount={room.bonusWords.length}
          isHost={isHost}
          onNextLevel={handleNextLevelTrigger}
          loadingNext={loadingNext}
        />
      )}
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Compass,
  Plus,
  Trophy,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Difficulty } from '../../shared/types';

interface LobbyScreenProps {
  nickname: string;
  onChangeNickname: (val: string) => void;
  personalScore: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  pendingInviteCode: string | null;
  onClearInviteCode: () => void;
  onCreateRoom: (difficulty: Difficulty) => void;
  onJoinRoom: (code: string) => void;
  busy: boolean;
  errorMsg: string | null;
}

const DIFFICULTIES: Array<{
  id: Difficulty;
  label: string;
  desc: string;
}> = [
  { id: 'easy', label: 'Лёгкий', desc: '4–5 букв · 4–7 слов' },
  { id: 'medium', label: 'Средний', desc: '6–7 букв · 7–11 слов' },
  { id: 'hard', label: 'Сложный', desc: '7–9 букв · 10–15 слов' },
];

export function LobbyScreen({
  nickname,
  onChangeNickname,
  personalScore,
  soundEnabled,
  onToggleSound,
  pendingInviteCode,
  onClearInviteCode,
  onCreateRoom,
  onJoinRoom,
  busy,
  errorMsg,
}: LobbyScreenProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [joinCode, setJoinCode] = useState(pendingInviteCode ?? '');

  const cleanNick = nickname.trim();
  const canSubmitNick = cleanNick.length >= 1;

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitNick || joinCode.trim().length !== 4 || busy) return;
    onJoinRoom(joinCode.trim().toUpperCase());
  };

  const handleCreate = () => {
    if (!canSubmitNick || busy) return;
    onCreateRoom(difficulty);
  };

  const handleCodeInput = (val: string) => {
    // Allow only unambiguous alphanumeric characters, uppercase, max 4
    const cleaned = val
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
    setJoinCode(cleaned);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top Bar: 3-zone contract */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <Compass className="h-6 w-6 text-amber-300" aria-hidden="true" />
          <span className="font-display text-xl font-bold tracking-tight text-white">
            СловоКруг
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-200/80 whitespace-nowrap">
          <span>Кооперативный кроссворд</span>
          <span aria-hidden="true">·</span>
          <span>До 4 игроков</span>
          <span aria-hidden="true">·</span>
          <span>Без таймеров</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className="flex items-center gap-1.5 text-sm font-medium text-amber-200 tabular-nums whitespace-nowrap"
            title="Личные накопленные очки"
          >
            <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <span>{personalScore}</span>
          </div>
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Выключить звук' : 'Включить звук'}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-slate-100 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {soundEnabled ? (
              <Volume2 className="h-5 w-5" />
            ) : (
              <VolumeX className="h-5 w-5 text-slate-400" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 pb-8 pt-2 sm:px-6">
        <div className="grid w-full grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
          {/* Left Editorial / Overview Panel (prominent on desktop, concise on mobile) */}
          <section className="flex flex-col justify-between rounded-3xl bg-slate-900/55 p-6 backdrop-blur-md border border-white/10 sm:p-8 lg:col-span-7">
            <div>
              <p className="text-xs font-medium text-amber-300/90">
                Русский словарь · Точный учёт Е и Ё
              </p>
              <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-white text-balance sm:text-4xl lg:text-5xl">
                Разгадывайте кроссворды вместе за одним столом
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-200/85 sm:text-base">
                Соединяйте буквы свайпом по кругу, открывайте общую сетку слов,
                собирайте редкие бонусные слова и общайтесь в чате комнаты без
                спешки и рекламы.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-5 border-t border-white/10 pt-6 sm:grid-cols-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  Живая сетка
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/80">
                  Каждый новый раунд генерируется заново из более чем 16 000
                  существительных.
                </p>
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  Общие подсказки
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/80">
                  3 бесплатные подсказки на уровень, а дополнительные можно
                  открыть за личные очки.
                </p>
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  Вход по ссылке
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/80">
                  Без регистрации: введите имя и отправьте 4-значный код или
                  ссылку друзьям.
                </p>
              </div>
            </div>
          </section>

          {/* Right Action Panel */}
          <section className="flex flex-col justify-between rounded-3xl bg-slate-900/70 p-6 backdrop-blur-md border border-white/15 shadow-2xl sm:p-8 lg:col-span-5">
            <div className="space-y-6">
              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-400/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100"
                >
                  {errorMsg}
                </div>
              )}

              {/* Nickname */}
              <div>
                <label
                  htmlFor="nickname-input"
                  className="block text-sm font-semibold text-slate-100"
                >
                  Ваше имя в игре
                </label>
                <input
                  id="nickname-input"
                  type="text"
                  maxLength={20}
                  value={nickname}
                  onChange={(e) => onChangeNickname(e.target.value)}
                  placeholder="Например, Алексей"
                  autoFocus={Boolean(pendingInviteCode)}
                  className="mt-2 h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 text-base text-white placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
                {!canSubmitNick && (
                  <p className="mt-1.5 text-xs text-amber-200/85">
                    Укажите имя, чтобы создать или войти в комнату
                  </p>
                )}
              </div>

              {pendingInviteCode ? (
                /* Focused invite flow when arriving via /room/XXXX */
                <form
                  onSubmit={handleJoinSubmit}
                  className="space-y-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-amber-200/90">
                        Приглашение в комнату
                      </p>
                      <p className="mt-0.5 font-mono text-2xl font-bold tracking-widest text-white">
                        {pendingInviteCode}
                      </p>
                    </div>
                    <Users className="h-6 w-6 text-amber-300" />
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmitNick || busy}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                  >
                    <span>{busy ? 'Входим...' : 'Войти в комнату'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClearInviteCode();
                      setJoinCode('');
                    }}
                    className="w-full py-2 text-xs text-slate-300 underline-offset-4 hover:text-white hover:underline"
                  >
                    Или создать свою комнату
                  </button>
                </form>
              ) : (
                <>
                  {/* Create Room */}
                  <div className="space-y-3 border-t border-white/10 pt-5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-slate-100">
                        Новая комната
                      </span>
                      <span className="text-xs text-slate-300/80">
                        {DIFFICULTIES.find((d) => d.id === difficulty)?.desc}
                      </span>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label="Сложность кроссворда"
                      className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-950/60 p-1.5 border border-white/10"
                    >
                      {DIFFICULTIES.map((item) => {
                        const active = difficulty === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setDifficulty(item.id)}
                            className={`min-h-[40px] rounded-lg px-2 py-2 text-xs font-semibold transition whitespace-nowrap ${
                              active
                                ? 'bg-amber-400 text-slate-950 shadow-sm'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={!canSubmitNick || busy}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/15 transition hover:bg-amber-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{busy ? 'Создаём...' : 'Создать комнату'}</span>
                    </button>
                  </div>

                  {/* Join by Code */}
                  <form
                    onSubmit={handleJoinSubmit}
                    className="space-y-3 border-t border-white/10 pt-5"
                  >
                    <label
                      htmlFor="room-code-input"
                      className="block text-sm font-semibold text-slate-100"
                    >
                      Войти по коду комнаты
                    </label>
                    <div className="flex gap-2.5">
                      <input
                        id="room-code-input"
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        maxLength={4}
                        value={joinCode}
                        onChange={(e) => handleCodeInput(e.target.value)}
                        placeholder="A7K2"
                        className="h-12 w-32 shrink-0 rounded-xl border border-white/15 bg-slate-950/60 px-3 text-center font-mono text-lg font-bold tracking-widest text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 sm:w-36"
                      />
                      <button
                        type="submit"
                        disabled={
                          !canSubmitNick || joinCode.length !== 4 || busy
                        }
                        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
                      >
                        <span>Войти</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

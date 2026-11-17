import { useState } from 'react';
import { Award, Crown, ArrowRight } from 'lucide-react';
import {
  WORD_TOPICS,
  type Difficulty,
  type RoomPlayer,
  type WordTopic,
} from '../../shared/types';

interface VictoryModalProps {
  levelNumber: number;
  currentDifficulty: Difficulty;
  currentTopic: WordTopic;
  players: RoomPlayer[];
  currentPlayerId: string;
  bonusCount: number;
  isHost: boolean;
  onNextLevel: (difficulty: Difficulty, topic: WordTopic) => void;
  loadingNext: boolean;
}

const DIFF_LABELS: Record<Difficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
};

export function VictoryModal({
  levelNumber,
  currentDifficulty,
  currentTopic,
  players,
  currentPlayerId,
  bonusCount,
  isHost,
  onNextLevel,
  loadingNext,
}: VictoryModalProps) {
  const [selectedDiff, setSelectedDiff] =
    useState<Difficulty>(currentDifficulty);
  const [selectedTopic, setSelectedTopic] = useState<WordTopic>(currentTopic);

  const sortedPlayers = [...players].sort(
    (a, b) => b.roundWordsFound - a.roundWordsFound || b.roundScore - a.roundScore
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-3xl border border-amber-300/25 bg-slate-900/95 p-6 shadow-2xl sm:p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-300">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-amber-300">
              Уровень #{levelNumber} пройден ·{' '}
              {WORD_TOPICS.find((t) => t.id === currentTopic)?.label ?? 'Все слова'} ·{' '}
              {DIFF_LABELS[currentDifficulty]}
            </p>
            <h2
              id="victory-title"
              className="font-display text-2xl font-bold text-white"
            >
              Кроссворд разгадан
            </h2>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-300 tabular-nums">
          Найдено бонусных слов: {bonusCount}
        </p>

        {/* Player round breakdown */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-2">
          <ul className="divide-y divide-white/10">
            {sortedPlayers.map((p) => (
              <li
                key={p.playerId}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-white">
                    {p.nickname}
                    {p.playerId === currentPlayerId ? ' (вы)' : ''}
                  </span>
                  {p.isHost && (
                    <Crown className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-300 tabular-nums whitespace-nowrap">
                  <span>{p.roundWordsFound} сл.</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-amber-300">
                    +{p.roundScore}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Host Next Level Controls */}
        {isHost ? (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((diff) => {
                const active = selectedDiff === diff;
                return (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setSelectedDiff(diff)}
                    className={`min-h-[40px] rounded-lg px-2 text-xs font-semibold transition whitespace-nowrap ${
                      active
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {DIFF_LABELS[diff]}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1 sm:grid-cols-3">
              {WORD_TOPICS.map((t) => {
                const active = selectedTopic === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTopic(t.id)}
                    className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold transition truncate ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={loadingNext}
              onClick={() => onNextLevel(selectedDiff, selectedTopic)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 active:scale-[0.99] disabled:opacity-50 whitespace-nowrap"
            >
              <span>
                {loadingNext ? 'Генерируем сетку...' : 'Следующий уровень'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="mt-6 text-center text-sm text-slate-300">
            Ожидаем, пока хост запустит следующий уровень…
          </p>
        )}
      </div>
    </div>
  );
}

import { X } from 'lucide-react';
import type { BonusWordEntry } from '../../shared/types';

interface BonusWordsModalProps {
  bonusWords: BonusWordEntry[];
  bonusPossibleCount: number;
  onClose: () => void;
}

export function BonusWordsModal({
  bonusWords,
  bonusPossibleCount,
  onClose,
}: BonusWordsModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bonus-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[78dvh] w-full max-w-md flex-col rounded-3xl border border-white/15 bg-slate-900/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <h2
              id="bonus-modal-title"
              className="font-display text-lg font-bold text-white"
            >
              Бонусные слова
            </h2>
            <p className="mt-0.5 text-xs text-slate-300 tabular-nums">
              Найдено {bonusWords.length} из {bonusPossibleCount} · +10 очков за слово
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно бонусных слов"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto">
          {bonusWords.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              Слова из этих букв, не вошедшие в сетку, засчитываются как
              бонусные. Пока ни одного не найдено.
            </p>
          ) : (
            <ul className="divide-y divide-white/10">
              {bonusWords.map((item) => (
                <li
                  key={item.word}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <span className="font-display font-semibold uppercase tracking-wide text-amber-200">
                    {item.word}
                  </span>
                  <span className="text-xs text-slate-400">{item.foundBy}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

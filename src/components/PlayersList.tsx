import { Crown } from 'lucide-react';
import type { RoomPlayer } from '../../shared/types';

interface PlayersListProps {
  players: RoomPlayer[];
  currentPlayerId: string;
}

export function PlayersList({ players, currentPlayerId }: PlayersListProps) {
  return (
    <ul className="divide-y divide-white/10">
      {players.map((p) => {
        const isMe = p.playerId === currentPlayerId;
        return (
          <li
            key={p.playerId}
            className="flex items-center justify-between gap-3 py-2.5 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                title={p.online ? 'В сети' : 'Переподключение...'}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  p.online ? 'bg-emerald-400' : 'bg-amber-400/70'
                }`}
              />
              <span className="truncate font-medium text-white">
                {p.nickname}
                {isMe ? ' (вы)' : ''}
              </span>
              {p.isHost && (
                <span title="Хост комнаты" className="shrink-0 text-amber-300">
                  <Crown className="h-3.5 w-3.5" aria-label="Хост" />
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-300 tabular-nums whitespace-nowrap">
              {!p.online && (
                <span className="text-amber-200/80">связь...</span>
              )}
              <span>{p.roundWordsFound} сл.</span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="text-amber-200/90">+{p.roundScore}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

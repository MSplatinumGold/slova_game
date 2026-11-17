const KEYS = {
  playerId: 'slovokrug_player_id',
  nickname: 'slovokrug_nickname',
  personalScore: 'slovokrug_personal_score',
  soundEnabled: 'slovokrug_sound_enabled',
} as const;

function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreatePlayerId(): string {
  try {
    let id = localStorage.getItem(KEYS.playerId);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : fallbackUuid();
      localStorage.setItem(KEYS.playerId, id);
    }
    return id;
  } catch {
    return fallbackUuid();
  }
}

export function getSavedNickname(): string {
  try {
    return localStorage.getItem(KEYS.nickname) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(KEYS.nickname, nickname.trim().slice(0, 20));
  } catch {
    // ignore storage errors
  }
}

export function getSavedPersonalScore(): number {
  try {
    const raw = localStorage.getItem(KEYS.personalScore);
    const num = raw ? Number(raw) : 0;
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
  } catch {
    return 0;
  }
}

export function savePersonalScore(score: number): void {
  try {
    const safe = Math.max(0, Math.floor(score));
    localStorage.setItem(KEYS.personalScore, String(safe));
  } catch {
    // ignore storage errors
  }
}

export function getSavedSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEYS.soundEnabled);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEYS.soundEnabled, String(enabled));
  } catch {
    // ignore storage errors
  }
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export type WordTopic =
  | 'all'
  | 'summer'
  | 'nature'
  | 'travel'
  | 'home'
  | 'science';

export const WORD_TOPICS: Array<{ id: WordTopic; label: string }> = [
  { id: 'all', label: 'Все слова' },
  { id: 'summer', label: 'Лето' },
  { id: 'nature', label: 'Природа' },
  { id: 'travel', label: 'Путешествия' },
  { id: 'home', label: 'Дом и уют' },
  { id: 'science', label: 'Космос и наука' },
];

export type WordDirection = 'H' | 'V';

export interface GridCellView {
  row: number;
  col: number;
  letter: string | null; // null when closed, uppercase Cyrillic char when opened
  revealedBy?: string;
  isHinted?: boolean;
}

export interface SolvedWordView {
  word: string;
  direction: WordDirection;
  row: number;
  col: number;
  solvedBy: string;
}

export interface BonusWordEntry {
  word: string;
  foundBy: string;
  foundAt: number;
}

export interface RoomPlayer {
  playerId: string;
  nickname: string;
  isHost: boolean;
  online: boolean;
  roundWordsFound: number;
  roundScore: number;
  personalScore: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  nickname: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface RoomStatePayload {
  code: string;
  difficulty: Difficulty;
  topic: WordTopic;
  levelNumber: number;
  wheelLetters: string[];
  grid: {
    rows: number;
    cols: number;
    cells: GridCellView[];
  };
  wordsTotal: number;
  wordsSolved: number;
  solvedWords: SolvedWordView[];
  bonusWords: BonusWordEntry[];
  bonusPossibleCount: number;
  sharedHints: number;
  roundComplete: boolean;
  players: RoomPlayer[];
  messages: ChatMessage[];
}

export type SubmitWordStatus =
  | 'solved'
  | 'bonus'
  | 'already_open'
  | 'already_bonus'
  | 'invalid';

export interface SubmitWordResult {
  status: SubmitWordStatus;
  word: string;
  pointsEarned: number;
  personalScore: number;
  message?: string;
}

export interface HintResult {
  ok: boolean;
  error?: string;
  revealedCell?: { row: number; col: number; letter: string };
  newlySolvedWords?: string[];
  roundComplete?: boolean;
  personalScore?: number;
}

import crypto from 'node:crypto';
import {
  WORD_TOPICS,
  type BonusWordEntry,
  type ChatMessage,
  type Difficulty,
  type GridCellView,
  type HintResult,
  type RoomPlayer,
  type RoomStatePayload,
  type SubmitWordResult,
  type WordTopic,
} from '../shared/types.ts';
import { generateCrossword, type GeneratedCrossword } from './crossword.ts';
import { getDictionary, normalizeInputWord } from './dictionary.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const INITIAL_SHARED_HINTS = 3;
const RECONNECT_GRACE_MS = 10_000;
const EMPTY_ROOM_TTL_MS = 120_000;
const LIGHTBULB_COST = 50;
const HAMMER_COST = 75;

interface InternalPlayer {
  playerId: string;
  socketId: string | null;
  nickname: string;
  isHost: boolean;
  online: boolean;
  joinedAt: number;
  roundWordsFound: number;
  roundScore: number;
  personalScore: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface InternalRoom {
  code: string;
  difficulty: Difficulty;
  topic: WordTopic;
  levelNumber: number;
  crossword: GeneratedCrossword;
  usedBaseWords: Set<string>;
  openCells: Map<string, { letter: string; revealedBy?: string; isHinted?: boolean }>;
  solvedWords: Map<string, { solvedBy: string }>;
  bonusSet: Set<string>;
  foundBonusWords: BonusWordEntry[];
  sharedHints: number;
  roundComplete: boolean;
  players: Map<string, InternalPlayer>;
  messages: ChatMessage[];
  emptyCleanupTimer: ReturnType<typeof setTimeout> | null;
}

export function sanitizeText(raw: unknown, maxLen: number, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  // Strip ASCII control chars & zero-width chars, collapse whitespace
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

export function sanitizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  return code;
}

export function sanitizeDifficulty(raw: unknown): Difficulty {
  if (raw === 'easy' || raw === 'medium' || raw === 'hard') return raw;
  return 'medium';
}

export function sanitizeTopic(raw: unknown): WordTopic {
  if (
    raw === 'all' ||
    raw === 'summer' ||
    raw === 'nature' ||
    raw === 'travel' ||
    raw === 'home' ||
    raw === 'science'
  ) {
    return raw;
  }
  return 'all';
}

export function sanitizeScore(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1_000_000, Math.floor(raw)));
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToPlayer = new Map<
    string,
    { roomCode: string; playerId: string }
  >();

  public getRoomCount(): number {
    return this.rooms.size;
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Failed to generate unique room code');
  }

  private addSystemMessage(room: InternalRoom, text: string): void {
    room.messages.push({
      id: crypto.randomUUID(),
      playerId: 'system',
      nickname: 'Система',
      text,
      timestamp: Date.now(),
      isSystem: true,
    });
    if (room.messages.length > 80) {
      room.messages.splice(0, room.messages.length - 80);
    }
  }

  public createRoom(params: {
    socketId: string;
    playerId: string;
    nickname: string;
    personalScore: number;
    difficulty: Difficulty;
    topic?: WordTopic;
  }): RoomStatePayload {
    this.detachSocket(params.socketId);

    const code = this.generateUniqueCode();
    const difficulty = sanitizeDifficulty(params.difficulty);
    const topic = sanitizeTopic(params.topic);
    const crossword = generateCrossword(difficulty, getDictionary(), { topic });

    const player: InternalPlayer = {
      playerId: sanitizeText(params.playerId, 64, crypto.randomUUID()),
      socketId: params.socketId,
      nickname: sanitizeText(params.nickname, 20, 'Игрок'),
      isHost: true,
      online: true,
      joinedAt: Date.now(),
      roundWordsFound: 0,
      roundScore: 0,
      personalScore: sanitizeScore(params.personalScore),
      disconnectTimer: null,
    };

    const room: InternalRoom = {
      code,
      difficulty,
      topic,
      levelNumber: 1,
      crossword,
      usedBaseWords: new Set([crossword.baseWord]),
      openCells: new Map(),
      solvedWords: new Map(),
      bonusSet: new Set(crossword.bonusWords),
      foundBonusWords: [],
      sharedHints: INITIAL_SHARED_HINTS,
      roundComplete: false,
      players: new Map([[player.playerId, player]]),
      messages: [],
      emptyCleanupTimer: null,
    };

    this.addSystemMessage(room, `${player.nickname} создал(а) комнату`);
    this.rooms.set(code, room);
    this.socketToPlayer.set(params.socketId, {
      roomCode: code,
      playerId: player.playerId,
    });

    return this.serializeRoom(room);
  }

  public joinRoom(params: {
    code: string;
    socketId: string;
    playerId: string;
    nickname: string;
    personalScore: number;
  }): { ok: true; state: RoomStatePayload; reconnected: boolean } | { ok: false; error: string; code: 'NOT_FOUND' | 'FULL' } {
    const cleanCode = sanitizeRoomCode(params.code);
    if (!cleanCode) {
      return { ok: false, error: 'Некорректный код комнаты', code: 'NOT_FOUND' };
    }

    const room = this.rooms.get(cleanCode);
    if (!room) {
      return {
        ok: false,
        error: 'Комната не найдена или сервер был перезагружен',
        code: 'NOT_FOUND',
      };
    }

    this.detachSocket(params.socketId);

    const playerId = sanitizeText(params.playerId, 64, crypto.randomUUID());
    const nickname = sanitizeText(params.nickname, 20, 'Игрок');
    const existing = room.players.get(playerId);

    if (room.emptyCleanupTimer) {
      clearTimeout(room.emptyCleanupTimer);
      room.emptyCleanupTimer = null;
    }

    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      const wasOffline = !existing.online;
      existing.socketId = params.socketId;
      existing.online = true;
      existing.nickname = nickname;
      // Keep server score if higher/active, or sync if higher client score on fresh rejoin
      existing.personalScore = Math.max(
        existing.personalScore,
        sanitizeScore(params.personalScore)
      );

      this.socketToPlayer.set(params.socketId, {
        roomCode: cleanCode,
        playerId,
      });

      if (wasOffline) {
        this.addSystemMessage(room, `${nickname} вернулся в игру`);
      }

      return { ok: true, state: this.serializeRoom(room), reconnected: true };
    }

    if (room.players.size >= MAX_PLAYERS) {
      return {
        ok: false,
        error: 'В комнате уже максимум игроков (4 из 4)',
        code: 'FULL',
      };
    }

    const hasHost = Array.from(room.players.values()).some((p) => p.isHost);
    const newPlayer: InternalPlayer = {
      playerId,
      socketId: params.socketId,
      nickname,
      isHost: !hasHost,
      online: true,
      joinedAt: Date.now(),
      roundWordsFound: 0,
      roundScore: 0,
      personalScore: sanitizeScore(params.personalScore),
      disconnectTimer: null,
    };

    room.players.set(playerId, newPlayer);
    this.socketToPlayer.set(params.socketId, {
      roomCode: cleanCode,
      playerId,
    });
    this.addSystemMessage(room, `${nickname} присоединился к комнате`);

    return { ok: true, state: this.serializeRoom(room), reconnected: false };
  }

  public renamePlayer(
    socketId: string,
    rawNickname: unknown
  ):
    | { ok: true; roomCode: string; nickname: string; state: RoomStatePayload }
    | { ok: false; error: string } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: 'Вы не в комнате' };

    const newNick = sanitizeText(rawNickname, 20);
    if (!newNick) {
      return { ok: false, error: 'Введите корректное имя (от 1 до 20 символов)' };
    }

    const { room, player } = ctx;
    const oldNick = player.nickname;
    if (oldNick === newNick) {
      return {
        ok: true,
        roomCode: room.code,
        nickname: newNick,
        state: this.serializeRoom(room),
      };
    }

    player.nickname = newNick;
    this.addSystemMessage(room, `${oldNick} сменил(а) имя на ${newNick}`);

    return {
      ok: true,
      roomCode: room.code,
      nickname: newNick,
      state: this.serializeRoom(room),
    };
  }

  public leaveRoomBySocket(
    socketId: string
  ): { roomCode: string; state: RoomStatePayload | null } | null {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    this.socketToPlayer.delete(socketId);

    const room = this.rooms.get(link.roomCode);
    if (!room) return null;

    const player = room.players.get(link.playerId);
    if (!player) return null;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    this.removePlayerFromRoom(room, player);

    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return { roomCode: room.code, state: null };
    }

    return { roomCode: room.code, state: this.serializeRoom(room) };
  }

  public handleSocketDisconnect(
    socketId: string,
    onGraceExpired: (roomCode: string, state: RoomStatePayload | null) => void
  ): { roomCode: string; state: RoomStatePayload } | null {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    this.socketToPlayer.delete(socketId);

    const room = this.rooms.get(link.roomCode);
    if (!room) return null;

    const player = room.players.get(link.playerId);
    if (!player) return null;

    // Only mark offline if this socket is still the active one for player
    if (player.socketId !== socketId) return null;

    player.online = false;
    player.socketId = null;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }

    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      const currentRoom = this.rooms.get(link.roomCode);
      if (!currentRoom) return;
      const p = currentRoom.players.get(link.playerId);
      if (!p || p.online) return;

      this.removePlayerFromRoom(currentRoom, p);

      if (currentRoom.players.size === 0) {
        // Keep empty room briefly (2 min) in case host refreshes on slow mobile network
        currentRoom.emptyCleanupTimer = setTimeout(() => {
          const r = this.rooms.get(currentRoom.code);
          if (r && r.players.size === 0) {
            this.rooms.delete(currentRoom.code);
          }
        }, EMPTY_ROOM_TTL_MS);
        onGraceExpired(currentRoom.code, null);
      } else {
        onGraceExpired(currentRoom.code, this.serializeRoom(currentRoom));
      }
    }, RECONNECT_GRACE_MS);

    return { roomCode: room.code, state: this.serializeRoom(room) };
  }

  private detachSocket(socketId: string): void {
    const prev = this.socketToPlayer.get(socketId);
    if (!prev) return;
    this.leaveRoomBySocket(socketId);
  }

  private removePlayerFromRoom(room: InternalRoom, player: InternalPlayer): void {
    const wasHost = player.isHost;
    room.players.delete(player.playerId);
    this.addSystemMessage(room, `${player.nickname} вышел из комнаты`);

    if (wasHost && room.players.size > 0) {
      // Prefer an online player first, otherwise earliest joined
      const remaining = Array.from(room.players.values()).sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.joinedAt - b.joinedAt;
      });
      if (remaining[0]) {
        remaining[0].isHost = true;
        this.addSystemMessage(
          room,
          `${remaining[0].nickname} теперь хост комнаты`
        );
      }
    }
  }

  public getPlayerContext(
    socketId: string
  ): { room: InternalRoom; player: InternalPlayer } | null {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    const room = this.rooms.get(link.roomCode);
    if (!room) return null;
    const player = room.players.get(link.playerId);
    if (!player) return null;
    return { room, player };
  }

  public submitWord(
    socketId: string,
    rawWord: unknown
  ): {
    result: SubmitWordResult;
    roomCode?: string;
    state?: RoomStatePayload;
    eventNotice?: { word: string; nickname: string; points: number; isBonus: boolean };
  } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) {
      return {
        result: {
          status: 'invalid',
          word: '',
          pointsEarned: 0,
          personalScore: 0,
          message: 'Вы не в комнате',
        },
      };
    }

    const { room, player } = ctx;
    if (typeof rawWord !== 'string') {
      return {
        result: {
          status: 'invalid',
          word: '',
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: 'Некорректное слово',
        },
      };
    }

    const word = normalizeInputWord(rawWord);
    if (word.length < 3 || word.length > 10 || !/^[а-яё]+$/.test(word)) {
      return {
        result: {
          status: 'invalid',
          word,
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: 'Слово должно быть от 3 букв',
        },
      };
    }

    if (room.roundComplete) {
      return {
        result: {
          status: 'already_open',
          word,
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: 'Кроссворд уже разгадан',
        },
      };
    }

    // 1. Check placed crossword words
    const placedMatch = room.crossword.placedWords.find((p) => p.word === word);
    if (placedMatch) {
      if (room.solvedWords.has(word)) {
        return {
          result: {
            status: 'already_open',
            word,
            pointsEarned: 0,
            personalScore: player.personalScore,
            message: 'Уже открыто',
          },
        };
      }

      // Reveal all cells of the word
      const dr = placedMatch.direction === 'V' ? 1 : 0;
      const dc = placedMatch.direction === 'H' ? 1 : 0;
      for (let i = 0; i < placedMatch.word.length; i++) {
        const r = placedMatch.row + i * dr;
        const c = placedMatch.col + i * dc;
        const k = cellKey(r, c);
        if (!room.openCells.has(k)) {
          room.openCells.set(k, {
            letter: placedMatch.word[i].toUpperCase(),
            revealedBy: player.nickname,
          });
        }
      }

      room.solvedWords.set(word, { solvedBy: player.nickname });
      const pointsEarned = word.length * 5;
      player.roundWordsFound += 1;
      player.roundScore += pointsEarned;
      player.personalScore += pointsEarned;

      // Check if opening this word accidentally completed another intersecting word
      this.checkAutoSolvedWords(room, player.nickname);

      if (room.solvedWords.size === room.crossword.placedWords.length) {
        room.roundComplete = true;
      }

      return {
        roomCode: room.code,
        state: this.serializeRoom(room),
        eventNotice: {
          word: word.toUpperCase(),
          nickname: player.nickname,
          points: pointsEarned,
          isBonus: false,
        },
        result: {
          status: 'solved',
          word,
          pointsEarned,
          personalScore: player.personalScore,
        },
      };
    }

    // 2. Check bonus words
    if (room.bonusSet.has(word)) {
      if (room.foundBonusWords.some((b) => b.word === word)) {
        return {
          result: {
            status: 'already_bonus',
            word,
            pointsEarned: 0,
            personalScore: player.personalScore,
            message: 'Бонус уже найден',
          },
        };
      }

      const pointsEarned = 10;
      room.foundBonusWords.unshift({
        word,
        foundBy: player.nickname,
        foundAt: Date.now(),
      });
      player.roundScore += pointsEarned;
      player.personalScore += pointsEarned;

      return {
        roomCode: room.code,
        state: this.serializeRoom(room),
        eventNotice: {
          word: word.toUpperCase(),
          nickname: player.nickname,
          points: pointsEarned,
          isBonus: true,
        },
        result: {
          status: 'bonus',
          word,
          pointsEarned,
          personalScore: player.personalScore,
          message: `Бонусное слово! +${pointsEarned}`,
        },
      };
    }

    return {
      result: {
        status: 'invalid',
        word,
        pointsEarned: 0,
        personalScore: player.personalScore,
        message: 'Нет такого слова',
      },
    };
  }

  private checkAutoSolvedWords(room: InternalRoom, triggeredBy: string): string[] {
    const newlySolved: string[] = [];
    for (const pw of room.crossword.placedWords) {
      if (room.solvedWords.has(pw.word)) continue;
      const dr = pw.direction === 'V' ? 1 : 0;
      const dc = pw.direction === 'H' ? 1 : 0;
      let allOpen = true;
      for (let i = 0; i < pw.word.length; i++) {
        const k = cellKey(pw.row + i * dr, pw.col + i * dc);
        if (!room.openCells.has(k)) {
          allOpen = false;
          break;
        }
      }
      if (allOpen) {
        room.solvedWords.set(pw.word, { solvedBy: triggeredBy });
        newlySolved.push(pw.word);
      }
    }
    return newlySolved;
  }

  public useHint(
    socketId: string,
    payload: { type: 'lightbulb' | 'hammer'; row?: number; col?: number }
  ): {
    result: HintResult;
    roomCode?: string;
    state?: RoomStatePayload;
    notice?: string;
  } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) {
      return { result: { ok: false, error: 'Вы не в комнате' } };
    }
    const { room, player } = ctx;

    if (room.roundComplete) {
      return { result: { ok: false, error: 'Кроссворд уже разгадан' } };
    }

    const hintType = payload.type;
    if (hintType !== 'lightbulb' && hintType !== 'hammer') {
      return { result: { ok: false, error: 'Неизвестный тип подсказки' } };
    }

    // Collect all valid closed cells
    const closedCells: Array<{ row: number; col: number; letter: string }> = [];
    const cellLetterMap = new Map<string, string>();
    for (const pw of room.crossword.placedWords) {
      const dr = pw.direction === 'V' ? 1 : 0;
      const dc = pw.direction === 'H' ? 1 : 0;
      for (let i = 0; i < pw.word.length; i++) {
        const r = pw.row + i * dr;
        const c = pw.col + i * dc;
        const k = cellKey(r, c);
        if (!cellLetterMap.has(k)) {
          cellLetterMap.set(k, pw.word[i].toUpperCase());
          if (!room.openCells.has(k)) {
            closedCells.push({ row: r, col: c, letter: pw.word[i].toUpperCase() });
          }
        }
      }
    }

    if (closedCells.length === 0) {
      return { result: { ok: false, error: 'Все клетки уже открыты' } };
    }

    let target: { row: number; col: number; letter: string } | undefined;
    if (hintType === 'hammer') {
      if (
        typeof payload.row !== 'number' ||
        typeof payload.col !== 'number' ||
        !Number.isInteger(payload.row) ||
        !Number.isInteger(payload.col)
      ) {
        return { result: { ok: false, error: 'Выберите закрытую клетку' } };
      }
      target = closedCells.find(
        (c) => c.row === payload.row && c.col === payload.col
      );
      if (!target) {
        return { result: { ok: false, error: 'Эта клетка уже открыта' } };
      }
    } else {
      target = closedCells[Math.floor(Math.random() * closedCells.length)];
    }

    // Check shared hint pool vs personal score purchase
    let paidPoints = 0;
    if (room.sharedHints > 0) {
      room.sharedHints -= 1;
    } else {
      const cost = hintType === 'lightbulb' ? LIGHTBULB_COST : HAMMER_COST;
      if (player.personalScore < cost) {
        return {
          result: {
            ok: false,
            error: `Бесплатные подсказки закончились. Нужно ${cost} личных очков`,
          },
        };
      }
      player.personalScore -= cost;
      paidPoints = cost;
    }

    room.openCells.set(cellKey(target.row, target.col), {
      letter: target.letter,
      revealedBy: player.nickname,
      isHinted: true,
    });

    // Edge-case: check if revealing this cell completed any words!
    const newlySolved = this.checkAutoSolvedWords(room, player.nickname);
    if (newlySolved.length > 0) {
      player.roundWordsFound += newlySolved.length;
    }

    if (room.solvedWords.size === room.crossword.placedWords.length) {
      room.roundComplete = true;
    }

    const hintLabel = hintType === 'lightbulb' ? 'лампочку' : 'молоточек';
    const costLabel = paidPoints > 0 ? ` за ${paidPoints} очков` : '';

    return {
      roomCode: room.code,
      state: this.serializeRoom(room),
      notice: `${player.nickname} открыл(а) букву (${hintLabel}${costLabel})`,
      result: {
        ok: true,
        revealedCell: target,
        newlySolvedWords: newlySolved,
        roundComplete: room.roundComplete,
        personalScore: player.personalScore,
      },
    };
  }

  private resetRoomCrossword(
    room: InternalRoom,
    nextDifficulty: Difficulty,
    nextTopic: WordTopic,
    incrementLevel: boolean
  ): void {
    if (room.usedBaseWords.size > 200) {
      room.usedBaseWords.clear();
    }
    const crossword = generateCrossword(nextDifficulty, getDictionary(), {
      topic: nextTopic,
      excludeBaseWords: room.usedBaseWords,
    });
    room.usedBaseWords.add(crossword.baseWord);
    room.difficulty = nextDifficulty;
    room.topic = nextTopic;
    if (incrementLevel) {
      room.levelNumber += 1;
    }
    room.crossword = crossword;
    room.openCells = new Map();
    room.solvedWords = new Map();
    room.bonusSet = new Set(crossword.bonusWords);
    room.foundBonusWords = [];
    room.sharedHints = INITIAL_SHARED_HINTS;
    room.roundComplete = false;

    for (const p of room.players.values()) {
      p.roundWordsFound = 0;
      p.roundScore = 0;
    }

    const diffLabel =
      nextDifficulty === 'easy'
        ? 'Лёгкий'
        : nextDifficulty === 'medium'
          ? 'Средний'
          : 'Сложный';
    const topicLabel =
      WORD_TOPICS.find((t) => t.id === nextTopic)?.label ?? 'Все слова';

    this.addSystemMessage(
      room,
      incrementLevel
        ? `Хост запустил уровень #${room.levelNumber} (${topicLabel} · ${diffLabel})`
        : `Хост пересоздал уровень #${room.levelNumber} (${topicLabel} · ${diffLabel})`
    );
  }

  public nextLevel(
    socketId: string,
    rawDifficulty?: unknown,
    rawTopic?: unknown
  ): { ok: true; roomCode: string; state: RoomStatePayload } | { ok: false; error: string } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: 'Вы не в комнате' };

    const { room, player } = ctx;
    if (!player.isHost) {
      return { ok: false, error: 'Только хост может запустить новый уровень' };
    }

    const nextDifficulty = rawDifficulty
      ? sanitizeDifficulty(rawDifficulty)
      : room.difficulty;
    const nextTopic = rawTopic ? sanitizeTopic(rawTopic) : room.topic;

    this.resetRoomCrossword(room, nextDifficulty, nextTopic, true);
    return { ok: true, roomCode: room.code, state: this.serializeRoom(room) };
  }

  public recreateLevel(
    socketId: string,
    rawDifficulty?: unknown,
    rawTopic?: unknown
  ): { ok: true; roomCode: string; state: RoomStatePayload } | { ok: false; error: string } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: 'Вы не в комнате' };

    const { room, player } = ctx;
    if (!player.isHost) {
      return { ok: false, error: 'Только хост может пересоздать уровень' };
    }

    const nextDifficulty = rawDifficulty
      ? sanitizeDifficulty(rawDifficulty)
      : room.difficulty;
    const nextTopic = rawTopic ? sanitizeTopic(rawTopic) : room.topic;

    this.resetRoomCrossword(room, nextDifficulty, nextTopic, false);
    return { ok: true, roomCode: room.code, state: this.serializeRoom(room) };
  }

  public addChatMessage(
    socketId: string,
    rawText: unknown
  ): { ok: true; roomCode: string; message: ChatMessage } | { ok: false; error: string } {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: 'Вы не в комнате' };

    const text = sanitizeText(rawText, 240);
    if (!text) return { ok: false, error: 'Пустое сообщение' };

    const { room, player } = ctx;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      playerId: player.playerId,
      nickname: player.nickname,
      text,
      timestamp: Date.now(),
    };

    room.messages.push(message);
    if (room.messages.length > 80) {
      room.messages.splice(0, room.messages.length - 80);
    }

    return { ok: true, roomCode: room.code, message };
  }

  public serializeRoom(room: InternalRoom): RoomStatePayload {
    const uniqueCells = new Map<string, GridCellView>();
    for (const pw of room.crossword.placedWords) {
      const dr = pw.direction === 'V' ? 1 : 0;
      const dc = pw.direction === 'H' ? 1 : 0;
      for (let i = 0; i < pw.word.length; i++) {
        const r = pw.row + i * dr;
        const c = pw.col + i * dc;
        const k = cellKey(r, c);
        if (!uniqueCells.has(k)) {
          const opened = room.openCells.get(k);
          uniqueCells.set(k, {
            row: r,
            col: c,
            letter: opened ? opened.letter : null,
            revealedBy: opened?.revealedBy,
            isHinted: opened?.isHinted,
          });
        }
      }
    }

    const players: RoomPlayer[] = Array.from(room.players.values())
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isHost: p.isHost,
        online: p.online,
        roundWordsFound: p.roundWordsFound,
        roundScore: p.roundScore,
        personalScore: p.personalScore,
      }));

    const solvedWords = room.crossword.placedWords
      .filter((pw) => room.solvedWords.has(pw.word))
      .map((pw) => ({
        word: pw.word.toUpperCase(),
        direction: pw.direction,
        row: pw.row,
        col: pw.col,
        solvedBy: room.solvedWords.get(pw.word)!.solvedBy,
      }));

    return {
      code: room.code,
      difficulty: room.difficulty,
      topic: room.topic,
      levelNumber: room.levelNumber,
      wheelLetters: room.crossword.wheelLetters.map((ch) => ch.toUpperCase()),
      grid: {
        rows: room.crossword.rows,
        cols: room.crossword.cols,
        cells: Array.from(uniqueCells.values()),
      },
      wordsTotal: room.crossword.placedWords.length,
      wordsSolved: room.solvedWords.size,
      solvedWords,
      bonusWords: room.foundBonusWords,
      bonusPossibleCount: room.bonusSet.size,
      sharedHints: room.sharedHints,
      roundComplete: room.roundComplete,
      players,
      messages: room.messages,
    };
  }
}

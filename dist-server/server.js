// server.ts
import http from "node:http";
import path2 from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

// server/dictionary.ts
import fs from "node:fs";
import path from "node:path";
var RUSSIAN_ALPHABET = "\u0430\u0431\u0432\u0433\u0434\u0435\u0451\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F";
var CHAR_TO_INDEX = /* @__PURE__ */ new Map();
for (let i = 0; i < RUSSIAN_ALPHABET.length; i++) {
  CHAR_TO_INDEX.set(RUSSIAN_ALPHABET[i], i);
}
function charIndex(ch) {
  return CHAR_TO_INDEX.get(ch) ?? -1;
}
function isValidRussianWord(word) {
  if (word.length < 3 || word.length > 10) return false;
  for (let i = 0; i < word.length; i++) {
    if (!CHAR_TO_INDEX.has(word[i])) return false;
  }
  return true;
}
function normalizeInputWord(raw) {
  return raw.trim().toLowerCase();
}
function computeWordSignature(word) {
  let maskLo = 0;
  let maskHi = 0;
  const counts = new Uint8Array(33);
  for (let i = 0; i < word.length; i++) {
    const idx = CHAR_TO_INDEX.get(word[i]);
    if (idx === void 0) continue;
    counts[idx]++;
    if (idx < 31) {
      maskLo |= 1 << idx;
    } else {
      maskHi |= 1 << idx - 31;
    }
  }
  return { maskLo, maskHi, counts };
}
var RussianDictionary = class {
  constructor(jsonPath) {
    this.entries = [];
    this.wordMap = /* @__PURE__ */ new Map();
    this.baseCandidates = {
      easy: [],
      medium: [],
      hard: []
    };
    const resolvedPath = jsonPath ?? path.resolve(process.cwd(), "server/data/russian_nouns.json");
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(raw);
    for (const item of parsed) {
      const w = item.w;
      if (!isValidRussianWord(w)) continue;
      if (this.wordMap.has(w)) continue;
      const { maskLo, maskHi, counts } = computeWordSignature(w);
      const entry = {
        word: w,
        tier: item.t,
        len: w.length,
        maskLo,
        maskHi,
        counts
      };
      this.entries.push(entry);
      this.wordMap.set(w, entry);
      if (entry.len >= 4 && entry.len <= 5 && entry.tier === 1) {
        this.baseCandidates.easy.push(entry);
      }
      if (entry.len >= 6 && entry.len <= 7 && entry.tier <= 2) {
        this.baseCandidates.medium.push(entry);
      }
      if (entry.len >= 7 && entry.len <= 9) {
        this.baseCandidates.hard.push(entry);
      }
    }
  }
  has(word) {
    return this.wordMap.has(word);
  }
  /**
   * Returns all dictionary words formable from `baseWord`'s multiset of letters.
   * Strictly distinguishes 'е' and 'ё'.
   */
  findSubwords(baseWord) {
    const { maskLo, maskHi, counts } = computeWordSignature(baseWord);
    const invLo = ~maskLo;
    const invHi = ~maskHi;
    const maxLen = baseWord.length;
    const result = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.len > maxLen) continue;
      if ((e.maskLo & invLo) !== 0 || (e.maskHi & invHi) !== 0) continue;
      let ok = true;
      for (let j = 0; j < e.len; j++) {
        const ci = CHAR_TO_INDEX.get(e.word[j]);
        if (e.counts[ci] > counts[ci]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        result.push(e);
      }
    }
    return result;
  }
};
var singletonDict = null;
function getDictionary() {
  if (!singletonDict) {
    singletonDict = new RussianDictionary();
  }
  return singletonDict;
}

// server/rooms.ts
import crypto from "node:crypto";

// server/crossword.ts
var DIFFICULTY_SPECS = {
  easy: { minWords: 4, maxWords: 7, minSubwordsPool: 5, maxGridTier: 2 },
  medium: { minWords: 7, maxWords: 11, minSubwordsPool: 10, maxGridTier: 2 },
  hard: { minWords: 10, maxWords: 15, minSubwordsPool: 16, maxGridTier: 3 }
};
var GRID_DIM = 64;
var GRID_CENTER = 32;
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
function evaluatePlacement(grid, dirGrid, word, startRow, startCol, dir) {
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  const perpDr = dc;
  const perpDc = dr;
  const len = word.length;
  const dirBit = dir === "H" ? 1 : 2;
  const endRow = startRow + (len - 1) * dr;
  const endCol = startCol + (len - 1) * dc;
  if (startRow < 2 || startCol < 2 || endRow >= GRID_DIM - 2 || endCol >= GRID_DIM - 2) {
    return -1;
  }
  const beforeIdx = (startRow - dr) * GRID_DIM + (startCol - dc);
  const afterIdx = (startRow + len * dr) * GRID_DIM + (startCol + len * dc);
  if (grid[beforeIdx] !== 0 || grid[afterIdx] !== 0) {
    return -1;
  }
  let intersections = 0;
  for (let i = 0; i < len; i++) {
    const r = startRow + i * dr;
    const c = startCol + i * dc;
    const idx = r * GRID_DIM + c;
    const code = charIndex(word[i]) + 1;
    const existing = grid[idx];
    if (existing !== 0) {
      if (existing !== code) return -1;
      if ((dirGrid[idx] & dirBit) !== 0) return -1;
      intersections++;
    } else {
      const n1 = (r - perpDr) * GRID_DIM + (c - perpDc);
      const n2 = (r + perpDr) * GRID_DIM + (c + perpDc);
      if (grid[n1] !== 0 || grid[n2] !== 0) {
        return -1;
      }
    }
  }
  return intersections;
}
function applyWord(state, word, row, col, dir) {
  const dr = dir === "V" ? 1 : 0;
  const dc = dir === "H" ? 1 : 0;
  const dirBit = dir === "H" ? 1 : 2;
  const undo = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr;
    const c = col + i * dc;
    const idx = r * GRID_DIM + c;
    undo.push({
      idx,
      prevLetter: state.grid[idx],
      prevDir: state.dirGrid[idx]
    });
    state.grid[idx] = charIndex(word[i]) + 1;
    state.dirGrid[idx] |= dirBit;
  }
  state.placed.push({ word, row, col, direction: dir });
  state.usedWords.add(word);
  return undo;
}
function revertWord(state, word, undo) {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    state.grid[u.idx] = u.prevLetter;
    state.dirGrid[u.idx] = u.prevDir;
  }
  state.placed.pop();
  state.usedWords.delete(word);
}
function findValidPlacements(state, word) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (let p = 0; p < state.placed.length; p++) {
    const pw = state.placed[p];
    const targetDir = pw.direction === "H" ? "V" : "H";
    const pDr = pw.direction === "V" ? 1 : 0;
    const pDc = pw.direction === "H" ? 1 : 0;
    const tDr = targetDir === "V" ? 1 : 0;
    const tDc = targetDir === "H" ? 1 : 0;
    for (let pi = 0; pi < pw.word.length; pi++) {
      const ch = pw.word[pi];
      const anchorR = pw.row + pi * pDr;
      const anchorC = pw.col + pi * pDc;
      for (let wi = 0; wi < word.length; wi++) {
        if (word[wi] !== ch) continue;
        const startR = anchorR - wi * tDr;
        const startC = anchorC - wi * tDc;
        const hash = startR * GRID_DIM + startC << 1 | (targetDir === "H" ? 0 : 1);
        if (seen.has(hash)) continue;
        seen.add(hash);
        const inter = evaluatePlacement(
          state.grid,
          state.dirGrid,
          word,
          startR,
          startC,
          targetDir
        );
        if (inter >= 1) {
          results.push({
            word,
            row: startR,
            col: startC,
            direction: targetDir,
            intersections: inter
          });
        }
      }
    }
  }
  return results;
}
function scoreLayout(placed, intersections) {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const pw of placed) {
    const dr = pw.direction === "V" ? 1 : 0;
    const dc = pw.direction === "H" ? 1 : 0;
    const r2 = pw.row + (pw.word.length - 1) * dr;
    const c2 = pw.col + (pw.word.length - 1) * dc;
    if (pw.row < minR) minR = pw.row;
    if (r2 > maxR) maxR = r2;
    if (pw.col < minC) minC = pw.col;
    if (c2 > maxC) maxC = c2;
  }
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const area = height * width;
  const aspectPenalty = Math.abs(width - height) * 1.5;
  return placed.length * 25 + intersections * 18 - area * 0.25 - aspectPenalty;
}
function buildGridForBaseWord(baseWord, candidates, spec, budgetMs) {
  const startTime = performance.now();
  const targetCount = spec.minWords + Math.floor(Math.random() * (spec.maxWords - spec.minWords + 1));
  const pool = candidates.filter((e) => e.word !== baseWord && e.tier <= spec.maxGridTier).map((e) => ({
    entry: e,
    weight: (4 - e.tier) * 10 + e.len * 2 + Math.random() * 14
  })).sort((a, b) => b.weight - a.weight).map((x) => x.entry.word);
  if (pool.length < spec.minWords + 4) {
    const extra = candidates.filter((e) => e.word !== baseWord && e.tier > spec.maxGridTier).map((e) => e.word);
    shuffleInPlace(extra);
    pool.push(...extra);
  }
  const orderedWords = [baseWord, ...pool.slice(0, 48)];
  const state = {
    grid: new Uint8Array(GRID_DIM * GRID_DIM),
    dirGrid: new Uint8Array(GRID_DIM * GRID_DIM),
    placed: [],
    usedWords: /* @__PURE__ */ new Set(),
    intersections: 0
  };
  const firstDir = Math.random() < 0.7 ? "H" : "V";
  const startR = firstDir === "H" ? GRID_CENTER : GRID_CENTER - Math.floor(baseWord.length / 2);
  const startC = firstDir === "H" ? GRID_CENTER - Math.floor(baseWord.length / 2) : GRID_CENTER;
  applyWord(state, baseWord, startR, startC, firstDir);
  let bestPlaced = null;
  let bestScore = -Infinity;
  let nodes = 0;
  function backtrack(poolIdx) {
    nodes++;
    if (nodes > 350 || performance.now() - startTime > budgetMs) {
      return;
    }
    if (state.placed.length >= spec.minWords) {
      const s = scoreLayout(state.placed, state.intersections);
      if (s > bestScore) {
        bestScore = s;
        bestPlaced = state.placed.map((p) => ({ ...p }));
      }
      if (state.placed.length >= targetCount) {
        return;
      }
    }
    let triedWords = 0;
    for (let i = poolIdx; i < orderedWords.length && triedWords < 14; i++) {
      const w = orderedWords[i];
      if (state.usedWords.has(w)) continue;
      const placements = findValidPlacements(state, w);
      if (placements.length === 0) continue;
      triedWords++;
      placements.sort(
        (a, b) => b.intersections - a.intersections + (Math.random() - 0.5) * 0.5
      );
      const branchLimit = Math.min(2, placements.length);
      for (let b = 0; b < branchLimit; b++) {
        const cand = placements[b];
        const undo = applyWord(state, cand.word, cand.row, cand.col, cand.direction);
        state.intersections += cand.intersections;
        backtrack(i + 1);
        state.intersections -= cand.intersections;
        revertWord(state, cand.word, undo);
        if (bestPlaced && bestPlaced.length >= targetCount && nodes > 120) {
          return;
        }
        if (performance.now() - startTime > budgetMs) {
          return;
        }
      }
    }
  }
  backtrack(1);
  if (bestPlaced && bestPlaced.length >= spec.minWords) {
    return { placed: bestPlaced, score: bestScore };
  }
  return null;
}
function generateCrossword(difficulty, dict = getDictionary()) {
  const startTime = performance.now();
  const spec = DIFFICULTY_SPECS[difficulty];
  const pool = dict.baseCandidates[difficulty];
  let bestResult = null;
  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && performance.now() - startTime > 200) break;
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const subwords = dict.findSubwords(candidate.word);
    const tierFiltered = subwords.filter((s) => s.tier <= spec.maxGridTier);
    if (tierFiltered.length < spec.minSubwordsPool) continue;
    const layout = buildGridForBaseWord(candidate.word, subwords, spec, 45);
    if (!layout) continue;
    if (!bestResult || layout.score > bestResult.score) {
      bestResult = {
        baseWord: candidate.word,
        subwords,
        placed: layout.placed,
        score: layout.score
      };
    }
    if (layout.placed.length >= spec.minWords + 1) {
      break;
    }
  }
  if (!bestResult) {
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const subwords = dict.findSubwords(candidate.word);
      if (subwords.length < spec.minSubwordsPool) continue;
      const layout = buildGridForBaseWord(candidate.word, subwords, spec, 50);
      if (layout) {
        bestResult = {
          baseWord: candidate.word,
          subwords,
          placed: layout.placed,
          score: layout.score
        };
        break;
      }
    }
  }
  if (!bestResult) {
    throw new Error(`Failed to generate crossword for difficulty=${difficulty}`);
  }
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const pw of bestResult.placed) {
    const dr = pw.direction === "V" ? 1 : 0;
    const dc = pw.direction === "H" ? 1 : 0;
    const r2 = pw.row + (pw.word.length - 1) * dr;
    const c2 = pw.col + (pw.word.length - 1) * dc;
    if (pw.row < minRow) minRow = pw.row;
    if (r2 > maxRow) maxRow = r2;
    if (pw.col < minCol) minCol = pw.col;
    if (c2 > maxCol) maxCol = c2;
  }
  const normalizedPlaced = bestResult.placed.map((pw) => ({
    word: pw.word,
    row: pw.row - minRow,
    col: pw.col - minCol,
    direction: pw.direction
  }));
  const gridWordSet = new Set(normalizedPlaced.map((pw) => pw.word));
  const bonusWords = bestResult.subwords.map((s) => s.word).filter((w) => !gridWordSet.has(w));
  const wheelLetters = shuffleInPlace(bestResult.baseWord.split(""));
  return {
    difficulty,
    baseWord: bestResult.baseWord,
    wheelLetters,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    placedWords: normalizedPlaced,
    bonusWords,
    generationMs: Math.round((performance.now() - startTime) * 10) / 10
  };
}

// server/rooms.ts
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var MAX_PLAYERS = 4;
var INITIAL_SHARED_HINTS = 3;
var RECONNECT_GRACE_MS = 1e4;
var EMPTY_ROOM_TTL_MS = 12e4;
var LIGHTBULB_COST = 50;
var HAMMER_COST = 75;
function sanitizeText(raw, maxLen, fallback = "") {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "").replace(/[<>]/g, "").trim().slice(0, maxLen);
  return cleaned || fallback;
}
function sanitizeRoomCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  return code;
}
function sanitizeDifficulty(raw) {
  if (raw === "easy" || raw === "medium" || raw === "hard") return raw;
  return "medium";
}
function sanitizeScore(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1e6, Math.floor(raw)));
}
function cellKey(row, col) {
  return `${row},${col}`;
}
var RoomManager = class {
  constructor() {
    this.rooms = /* @__PURE__ */ new Map();
    this.socketToPlayer = /* @__PURE__ */ new Map();
  }
  getRoomCount() {
    return this.rooms.size;
  }
  generateUniqueCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Failed to generate unique room code");
  }
  addSystemMessage(room, text) {
    room.messages.push({
      id: crypto.randomUUID(),
      playerId: "system",
      nickname: "\u0421\u0438\u0441\u0442\u0435\u043C\u0430",
      text,
      timestamp: Date.now(),
      isSystem: true
    });
    if (room.messages.length > 80) {
      room.messages.splice(0, room.messages.length - 80);
    }
  }
  createRoom(params) {
    this.detachSocket(params.socketId);
    const code = this.generateUniqueCode();
    const difficulty = sanitizeDifficulty(params.difficulty);
    const crossword = generateCrossword(difficulty, getDictionary());
    const player = {
      playerId: sanitizeText(params.playerId, 64, crypto.randomUUID()),
      socketId: params.socketId,
      nickname: sanitizeText(params.nickname, 20, "\u0418\u0433\u0440\u043E\u043A"),
      isHost: true,
      online: true,
      joinedAt: Date.now(),
      roundWordsFound: 0,
      roundScore: 0,
      personalScore: sanitizeScore(params.personalScore),
      disconnectTimer: null
    };
    const room = {
      code,
      difficulty,
      levelNumber: 1,
      crossword,
      openCells: /* @__PURE__ */ new Map(),
      solvedWords: /* @__PURE__ */ new Map(),
      bonusSet: new Set(crossword.bonusWords),
      foundBonusWords: [],
      sharedHints: INITIAL_SHARED_HINTS,
      roundComplete: false,
      players: /* @__PURE__ */ new Map([[player.playerId, player]]),
      messages: [],
      emptyCleanupTimer: null
    };
    this.addSystemMessage(room, `${player.nickname} \u0441\u043E\u0437\u0434\u0430\u043B(\u0430) \u043A\u043E\u043C\u043D\u0430\u0442\u0443`);
    this.rooms.set(code, room);
    this.socketToPlayer.set(params.socketId, {
      roomCode: code,
      playerId: player.playerId
    });
    return this.serializeRoom(room);
  }
  joinRoom(params) {
    const cleanCode = sanitizeRoomCode(params.code);
    if (!cleanCode) {
      return { ok: false, error: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043A\u043E\u0434 \u043A\u043E\u043C\u043D\u0430\u0442\u044B", code: "NOT_FOUND" };
    }
    const room = this.rooms.get(cleanCode);
    if (!room) {
      return {
        ok: false,
        error: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0438\u043B\u0438 \u0441\u0435\u0440\u0432\u0435\u0440 \u0431\u044B\u043B \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D",
        code: "NOT_FOUND"
      };
    }
    this.detachSocket(params.socketId);
    const playerId = sanitizeText(params.playerId, 64, crypto.randomUUID());
    const nickname = sanitizeText(params.nickname, 20, "\u0418\u0433\u0440\u043E\u043A");
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
      existing.personalScore = Math.max(
        existing.personalScore,
        sanitizeScore(params.personalScore)
      );
      this.socketToPlayer.set(params.socketId, {
        roomCode: cleanCode,
        playerId
      });
      if (wasOffline) {
        this.addSystemMessage(room, `${nickname} \u0432\u0435\u0440\u043D\u0443\u043B\u0441\u044F \u0432 \u0438\u0433\u0440\u0443`);
      }
      return { ok: true, state: this.serializeRoom(room), reconnected: true };
    }
    if (room.players.size >= MAX_PLAYERS) {
      return {
        ok: false,
        error: "\u0412 \u043A\u043E\u043C\u043D\u0430\u0442\u0435 \u0443\u0436\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0438\u0433\u0440\u043E\u043A\u043E\u0432 (4 \u0438\u0437 4)",
        code: "FULL"
      };
    }
    const hasHost = Array.from(room.players.values()).some((p) => p.isHost);
    const newPlayer = {
      playerId,
      socketId: params.socketId,
      nickname,
      isHost: !hasHost,
      online: true,
      joinedAt: Date.now(),
      roundWordsFound: 0,
      roundScore: 0,
      personalScore: sanitizeScore(params.personalScore),
      disconnectTimer: null
    };
    room.players.set(playerId, newPlayer);
    this.socketToPlayer.set(params.socketId, {
      roomCode: cleanCode,
      playerId
    });
    this.addSystemMessage(room, `${nickname} \u043F\u0440\u0438\u0441\u043E\u0435\u0434\u0438\u043D\u0438\u043B\u0441\u044F \u043A \u043A\u043E\u043C\u043D\u0430\u0442\u0435`);
    return { ok: true, state: this.serializeRoom(room), reconnected: false };
  }
  leaveRoomBySocket(socketId) {
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
  handleSocketDisconnect(socketId, onGraceExpired) {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    this.socketToPlayer.delete(socketId);
    const room = this.rooms.get(link.roomCode);
    if (!room) return null;
    const player = room.players.get(link.playerId);
    if (!player) return null;
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
  detachSocket(socketId) {
    const prev = this.socketToPlayer.get(socketId);
    if (!prev) return;
    this.leaveRoomBySocket(socketId);
  }
  removePlayerFromRoom(room, player) {
    const wasHost = player.isHost;
    room.players.delete(player.playerId);
    this.addSystemMessage(room, `${player.nickname} \u0432\u044B\u0448\u0435\u043B \u0438\u0437 \u043A\u043E\u043C\u043D\u0430\u0442\u044B`);
    if (wasHost && room.players.size > 0) {
      const remaining = Array.from(room.players.values()).sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.joinedAt - b.joinedAt;
      });
      if (remaining[0]) {
        remaining[0].isHost = true;
        this.addSystemMessage(
          room,
          `${remaining[0].nickname} \u0442\u0435\u043F\u0435\u0440\u044C \u0445\u043E\u0441\u0442 \u043A\u043E\u043C\u043D\u0430\u0442\u044B`
        );
      }
    }
  }
  getPlayerContext(socketId) {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    const room = this.rooms.get(link.roomCode);
    if (!room) return null;
    const player = room.players.get(link.playerId);
    if (!player) return null;
    return { room, player };
  }
  submitWord(socketId, rawWord) {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) {
      return {
        result: {
          status: "invalid",
          word: "",
          pointsEarned: 0,
          personalScore: 0,
          message: "\u0412\u044B \u043D\u0435 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0435"
        }
      };
    }
    const { room, player } = ctx;
    if (typeof rawWord !== "string") {
      return {
        result: {
          status: "invalid",
          word: "",
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0441\u043B\u043E\u0432\u043E"
        }
      };
    }
    const word = normalizeInputWord(rawWord);
    if (word.length < 3 || word.length > 10 || !/^[а-яё]+$/.test(word)) {
      return {
        result: {
          status: "invalid",
          word,
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: "\u0421\u043B\u043E\u0432\u043E \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u043E\u0442 3 \u0431\u0443\u043A\u0432"
        }
      };
    }
    if (room.roundComplete) {
      return {
        result: {
          status: "already_open",
          word,
          pointsEarned: 0,
          personalScore: player.personalScore,
          message: "\u041A\u0440\u043E\u0441\u0441\u0432\u043E\u0440\u0434 \u0443\u0436\u0435 \u0440\u0430\u0437\u0433\u0430\u0434\u0430\u043D"
        }
      };
    }
    const placedMatch = room.crossword.placedWords.find((p) => p.word === word);
    if (placedMatch) {
      if (room.solvedWords.has(word)) {
        return {
          result: {
            status: "already_open",
            word,
            pointsEarned: 0,
            personalScore: player.personalScore,
            message: "\u0423\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u043E"
          }
        };
      }
      const dr = placedMatch.direction === "V" ? 1 : 0;
      const dc = placedMatch.direction === "H" ? 1 : 0;
      for (let i = 0; i < placedMatch.word.length; i++) {
        const r = placedMatch.row + i * dr;
        const c = placedMatch.col + i * dc;
        const k = cellKey(r, c);
        if (!room.openCells.has(k)) {
          room.openCells.set(k, {
            letter: placedMatch.word[i].toUpperCase(),
            revealedBy: player.nickname
          });
        }
      }
      room.solvedWords.set(word, { solvedBy: player.nickname });
      const pointsEarned = word.length * 5;
      player.roundWordsFound += 1;
      player.roundScore += pointsEarned;
      player.personalScore += pointsEarned;
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
          isBonus: false
        },
        result: {
          status: "solved",
          word,
          pointsEarned,
          personalScore: player.personalScore
        }
      };
    }
    if (room.bonusSet.has(word)) {
      if (room.foundBonusWords.some((b) => b.word === word)) {
        return {
          result: {
            status: "already_bonus",
            word,
            pointsEarned: 0,
            personalScore: player.personalScore,
            message: "\u0411\u043E\u043D\u0443\u0441 \u0443\u0436\u0435 \u043D\u0430\u0439\u0434\u0435\u043D"
          }
        };
      }
      const pointsEarned = 10;
      room.foundBonusWords.unshift({
        word,
        foundBy: player.nickname,
        foundAt: Date.now()
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
          isBonus: true
        },
        result: {
          status: "bonus",
          word,
          pointsEarned,
          personalScore: player.personalScore,
          message: `\u0411\u043E\u043D\u0443\u0441\u043D\u043E\u0435 \u0441\u043B\u043E\u0432\u043E! +${pointsEarned}`
        }
      };
    }
    return {
      result: {
        status: "invalid",
        word,
        pointsEarned: 0,
        personalScore: player.personalScore,
        message: "\u041D\u0435\u0442 \u0442\u0430\u043A\u043E\u0433\u043E \u0441\u043B\u043E\u0432\u0430"
      }
    };
  }
  checkAutoSolvedWords(room, triggeredBy) {
    const newlySolved = [];
    for (const pw of room.crossword.placedWords) {
      if (room.solvedWords.has(pw.word)) continue;
      const dr = pw.direction === "V" ? 1 : 0;
      const dc = pw.direction === "H" ? 1 : 0;
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
  useHint(socketId, payload) {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) {
      return { result: { ok: false, error: "\u0412\u044B \u043D\u0435 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0435" } };
    }
    const { room, player } = ctx;
    if (room.roundComplete) {
      return { result: { ok: false, error: "\u041A\u0440\u043E\u0441\u0441\u0432\u043E\u0440\u0434 \u0443\u0436\u0435 \u0440\u0430\u0437\u0433\u0430\u0434\u0430\u043D" } };
    }
    const hintType = payload.type;
    if (hintType !== "lightbulb" && hintType !== "hammer") {
      return { result: { ok: false, error: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0438\u043F \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0438" } };
    }
    const closedCells = [];
    const cellLetterMap = /* @__PURE__ */ new Map();
    for (const pw of room.crossword.placedWords) {
      const dr = pw.direction === "V" ? 1 : 0;
      const dc = pw.direction === "H" ? 1 : 0;
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
      return { result: { ok: false, error: "\u0412\u0441\u0435 \u043A\u043B\u0435\u0442\u043A\u0438 \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B" } };
    }
    let target;
    if (hintType === "hammer") {
      if (typeof payload.row !== "number" || typeof payload.col !== "number" || !Number.isInteger(payload.row) || !Number.isInteger(payload.col)) {
        return { result: { ok: false, error: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u043A\u043B\u0435\u0442\u043A\u0443" } };
      }
      target = closedCells.find(
        (c) => c.row === payload.row && c.col === payload.col
      );
      if (!target) {
        return { result: { ok: false, error: "\u042D\u0442\u0430 \u043A\u043B\u0435\u0442\u043A\u0430 \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430" } };
      }
    } else {
      target = closedCells[Math.floor(Math.random() * closedCells.length)];
    }
    let paidPoints = 0;
    if (room.sharedHints > 0) {
      room.sharedHints -= 1;
    } else {
      const cost = hintType === "lightbulb" ? LIGHTBULB_COST : HAMMER_COST;
      if (player.personalScore < cost) {
        return {
          result: {
            ok: false,
            error: `\u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0435 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0438 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C. \u041D\u0443\u0436\u043D\u043E ${cost} \u043B\u0438\u0447\u043D\u044B\u0445 \u043E\u0447\u043A\u043E\u0432`
          }
        };
      }
      player.personalScore -= cost;
      paidPoints = cost;
    }
    room.openCells.set(cellKey(target.row, target.col), {
      letter: target.letter,
      revealedBy: player.nickname,
      isHinted: true
    });
    const newlySolved = this.checkAutoSolvedWords(room, player.nickname);
    if (newlySolved.length > 0) {
      player.roundWordsFound += newlySolved.length;
    }
    if (room.solvedWords.size === room.crossword.placedWords.length) {
      room.roundComplete = true;
    }
    const hintLabel = hintType === "lightbulb" ? "\u043B\u0430\u043C\u043F\u043E\u0447\u043A\u0443" : "\u043C\u043E\u043B\u043E\u0442\u043E\u0447\u0435\u043A";
    const costLabel = paidPoints > 0 ? ` \u0437\u0430 ${paidPoints} \u043E\u0447\u043A\u043E\u0432` : "";
    return {
      roomCode: room.code,
      state: this.serializeRoom(room),
      notice: `${player.nickname} \u043E\u0442\u043A\u0440\u044B\u043B(\u0430) \u0431\u0443\u043A\u0432\u0443 (${hintLabel}${costLabel})`,
      result: {
        ok: true,
        revealedCell: target,
        newlySolvedWords: newlySolved,
        roundComplete: room.roundComplete,
        personalScore: player.personalScore
      }
    };
  }
  nextLevel(socketId, rawDifficulty) {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: "\u0412\u044B \u043D\u0435 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0435" };
    const { room, player } = ctx;
    if (!player.isHost) {
      return { ok: false, error: "\u0422\u043E\u043B\u044C\u043A\u043E \u0445\u043E\u0441\u0442 \u043C\u043E\u0436\u0435\u0442 \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u0443\u0440\u043E\u0432\u0435\u043D\u044C" };
    }
    const nextDifficulty = rawDifficulty ? sanitizeDifficulty(rawDifficulty) : room.difficulty;
    const crossword = generateCrossword(nextDifficulty, getDictionary());
    room.difficulty = nextDifficulty;
    room.levelNumber += 1;
    room.crossword = crossword;
    room.openCells = /* @__PURE__ */ new Map();
    room.solvedWords = /* @__PURE__ */ new Map();
    room.bonusSet = new Set(crossword.bonusWords);
    room.foundBonusWords = [];
    room.sharedHints = INITIAL_SHARED_HINTS;
    room.roundComplete = false;
    for (const p of room.players.values()) {
      p.roundWordsFound = 0;
      p.roundScore = 0;
    }
    const diffLabel = nextDifficulty === "easy" ? "\u041B\u0451\u0433\u043A\u0438\u0439" : nextDifficulty === "medium" ? "\u0421\u0440\u0435\u0434\u043D\u0438\u0439" : "\u0421\u043B\u043E\u0436\u043D\u044B\u0439";
    this.addSystemMessage(
      room,
      `\u0425\u043E\u0441\u0442 \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u043B \u0443\u0440\u043E\u0432\u0435\u043D\u044C #${room.levelNumber} (${diffLabel})`
    );
    return { ok: true, roomCode: room.code, state: this.serializeRoom(room) };
  }
  addChatMessage(socketId, rawText) {
    const ctx = this.getPlayerContext(socketId);
    if (!ctx) return { ok: false, error: "\u0412\u044B \u043D\u0435 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0435" };
    const text = sanitizeText(rawText, 240);
    if (!text) return { ok: false, error: "\u041F\u0443\u0441\u0442\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435" };
    const { room, player } = ctx;
    const message = {
      id: crypto.randomUUID(),
      playerId: player.playerId,
      nickname: player.nickname,
      text,
      timestamp: Date.now()
    };
    room.messages.push(message);
    if (room.messages.length > 80) {
      room.messages.splice(0, room.messages.length - 80);
    }
    return { ok: true, roomCode: room.code, message };
  }
  serializeRoom(room) {
    const uniqueCells = /* @__PURE__ */ new Map();
    for (const pw of room.crossword.placedWords) {
      const dr = pw.direction === "V" ? 1 : 0;
      const dc = pw.direction === "H" ? 1 : 0;
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
            isHinted: opened?.isHinted
          });
        }
      }
    }
    const players = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isHost: p.isHost,
      online: p.online,
      roundWordsFound: p.roundWordsFound,
      roundScore: p.roundScore,
      personalScore: p.personalScore
    }));
    const solvedWords = room.crossword.placedWords.filter((pw) => room.solvedWords.has(pw.word)).map((pw) => ({
      word: pw.word.toUpperCase(),
      direction: pw.direction,
      row: pw.row,
      col: pw.col,
      solvedBy: room.solvedWords.get(pw.word).solvedBy
    }));
    return {
      code: room.code,
      difficulty: room.difficulty,
      levelNumber: room.levelNumber,
      wheelLetters: room.crossword.wheelLetters.map((ch) => ch.toUpperCase()),
      grid: {
        rows: room.crossword.rows,
        cols: room.crossword.cols,
        cells: Array.from(uniqueCells.values())
      },
      wordsTotal: room.crossword.placedWords.length,
      wordsSolved: room.solvedWords.size,
      solvedWords,
      bonusWords: room.foundBonusWords,
      bonusPossibleCount: room.bonusSet.size,
      sharedHints: room.sharedHints,
      roundComplete: room.roundComplete,
      players,
      messages: room.messages
    };
  }
};

// server.ts
var PORT = Number(process.env.PORT) || 3e3;
var IS_PROD = process.env.NODE_ENV === "production";
var SocketRateLimiter = class {
  constructor() {
    this.hits = /* @__PURE__ */ new Map();
  }
  allow(key, maxRequests, windowMs) {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= maxRequests) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  clearPrefix(socketId) {
    for (const k of this.hits.keys()) {
      if (k.startsWith(socketId)) {
        this.hits.delete(k);
      }
    }
  }
};
async function startServer() {
  const dict = getDictionary();
  console.log(`[dictionary] Loaded ${dict.entries.length} Russian common nouns`);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  const roomManager = new RoomManager();
  const rateLimiter = new SocketRateLimiter();
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      rooms: roomManager.getRoomCount(),
      words: dict.entries.length
    });
  });
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 2e4,
    pingTimeout: 25e3
  });
  io.on("connection", (socket) => {
    const safeCallback = (cb, data) => {
      if (typeof cb === "function") {
        try {
          cb(data);
        } catch {
        }
      }
    };
    socket.on(
      "room:create",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:create`, 5, 1e4)) {
            safeCallback(cb, { ok: false, error: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E" });
            return;
          }
          const state = roomManager.createRoom({
            socketId: socket.id,
            playerId: payload?.playerId ?? "",
            nickname: payload?.nickname ?? "\u0418\u0433\u0440\u043E\u043A",
            personalScore: payload?.personalScore ?? 0,
            difficulty: sanitizeDifficulty(payload?.difficulty)
          });
          socket.join(state.code);
          safeCallback(cb, { ok: true, state });
        } catch (err) {
          console.error("[room:create] error:", err);
          safeCallback(cb, {
            ok: false,
            error: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043A\u043E\u043C\u043D\u0430\u0442\u0443. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437"
          });
        }
      }
    );
    socket.on(
      "room:join",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:join`, 10, 1e4)) {
            safeCallback(cb, { ok: false, error: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A \u0432\u0445\u043E\u0434\u0430" });
            return;
          }
          const res = roomManager.joinRoom({
            code: payload?.code ?? "",
            socketId: socket.id,
            playerId: payload?.playerId ?? "",
            nickname: payload?.nickname ?? "\u0418\u0433\u0440\u043E\u043A",
            personalScore: payload?.personalScore ?? 0
          });
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          socket.join(res.state.code);
          socket.to(res.state.code).emit("room:state", res.state);
          safeCallback(cb, { ok: true, state: res.state });
        } catch (err) {
          console.error("[room:join] error:", err);
          safeCallback(cb, { ok: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0432\u0445\u043E\u0434\u0430 \u0432 \u043A\u043E\u043C\u043D\u0430\u0442\u0443" });
        }
      }
    );
    socket.on("room:leave", (cb) => {
      try {
        const res = roomManager.leaveRoomBySocket(socket.id);
        if (res) {
          socket.leave(res.roomCode);
          if (res.state) {
            io.to(res.roomCode).emit("room:state", res.state);
          }
        }
        safeCallback(cb, { ok: true });
      } catch (err) {
        console.error("[room:leave] error:", err);
        safeCallback(cb, { ok: false });
      }
    });
    socket.on(
      "game:submit_word",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:word`, 30, 1e4)) {
            safeCallback(cb, {
              status: "invalid",
              word: "",
              pointsEarned: 0,
              personalScore: 0,
              message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u0430\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0430"
            });
            return;
          }
          const out = roomManager.submitWord(socket.id, payload?.word);
          if (out.roomCode && out.state) {
            io.to(out.roomCode).emit("room:state", out.state);
            if (out.eventNotice) {
              io.to(out.roomCode).emit("game:word_notice", out.eventNotice);
            }
          }
          safeCallback(cb, out.result);
        } catch (err) {
          console.error("[game:submit_word] error:", err);
          safeCallback(cb, {
            status: "invalid",
            word: "",
            pointsEarned: 0,
            personalScore: 0,
            message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u043B\u043E\u0432\u0430"
          });
        }
      }
    );
    socket.on(
      "game:use_hint",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:hint`, 10, 1e4)) {
            safeCallback(cb, {
              ok: false,
              error: "\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u0441\u0435\u043A\u0443\u043D\u0434\u0443"
            });
            return;
          }
          const out = roomManager.useHint(socket.id, {
            type: payload?.type ?? "lightbulb",
            row: payload?.row,
            col: payload?.col
          });
          if (out.roomCode && out.state) {
            io.to(out.roomCode).emit("room:state", out.state);
            if (out.notice) {
              io.to(out.roomCode).emit("game:hint_notice", {
                text: out.notice,
                cell: out.result.revealedCell,
                newlySolvedWords: out.result.newlySolvedWords ?? []
              });
            }
          }
          safeCallback(cb, out.result);
        } catch (err) {
          console.error("[game:use_hint] error:", err);
          safeCallback(cb, {
            ok: false,
            error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0438"
          });
        }
      }
    );
    socket.on(
      "game:next_level",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:next`, 4, 1e4)) {
            safeCallback(cb, { ok: false, error: "\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E" });
            return;
          }
          const res = roomManager.nextLevel(socket.id, payload?.difficulty);
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit("room:state", res.state);
          safeCallback(cb, { ok: true, state: res.state });
        } catch (err) {
          console.error("[game:next_level] error:", err);
          safeCallback(cb, {
            ok: false,
            error: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u043A\u0440\u043E\u0441\u0441\u0432\u043E\u0440\u0434"
          });
        }
      }
    );
    socket.on(
      "chat:send",
      (payload, cb) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:chat`, 12, 1e4)) {
            safeCallback(cb, { ok: false, error: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439" });
            return;
          }
          const res = roomManager.addChatMessage(socket.id, payload?.text);
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit("chat:message", res.message);
          safeCallback(cb, { ok: true });
        } catch (err) {
          console.error("[chat:send] error:", err);
          safeCallback(cb, { ok: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" });
        }
      }
    );
    socket.on("disconnect", () => {
      try {
        rateLimiter.clearPrefix(socket.id);
        const res = roomManager.handleSocketDisconnect(
          socket.id,
          (roomCode, stateAfterGrace) => {
            if (stateAfterGrace) {
              io.to(roomCode).emit("room:state", stateAfterGrace);
            }
          }
        );
        if (res) {
          io.to(res.roomCode).emit("room:state", res.state);
        }
      } catch (err) {
        console.error("[disconnect] error:", err);
      }
    });
  });
  if (IS_PROD) {
    const distDir = path2.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? "production" : "dev"})`);
  });
}
startServer().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});

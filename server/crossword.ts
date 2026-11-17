import type { Difficulty, WordDirection } from '../shared/types.ts';
import { charIndex, type DictEntry, getDictionary, type RussianDictionary } from './dictionary.ts';

export interface PlacedWord {
  word: string;
  row: number;
  col: number;
  direction: WordDirection;
}

export interface GeneratedCrossword {
  difficulty: Difficulty;
  baseWord: string;
  wheelLetters: string[];
  rows: number;
  cols: number;
  placedWords: PlacedWord[];
  bonusWords: string[];
  generationMs: number;
}

interface DifficultySpec {
  minWords: number;
  maxWords: number;
  minSubwordsPool: number;
  maxGridTier: 1 | 2 | 3;
}

const DIFFICULTY_SPECS: Record<Difficulty, DifficultySpec> = {
  easy: { minWords: 4, maxWords: 7, minSubwordsPool: 5, maxGridTier: 2 },
  medium: { minWords: 7, maxWords: 11, minSubwordsPool: 10, maxGridTier: 2 },
  hard: { minWords: 10, maxWords: 15, minSubwordsPool: 16, maxGridTier: 3 },
};

const GRID_DIM = 64;
const GRID_CENTER = 32;

interface PlacementCandidate {
  word: string;
  row: number;
  col: number;
  direction: WordDirection;
  intersections: number;
}

interface SearchState {
  grid: Uint8Array;
  dirGrid: Uint8Array; // bit 1 = H, bit 2 = V
  placed: PlacedWord[];
  usedWords: Set<string>;
  intersections: number;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Checks if `word` can be placed at (startRow, startCol) with `dir`
 * obeying classic crossword adjacency rules:
 * - End caps (before start and after end) must be empty.
 * - Overlapping cells must match letter AND have opposite orientation.
 * - Non-overlapping cells must have empty perpendicular neighbors.
 * Returns intersection count >= 0, or -1 if invalid.
 */
function evaluatePlacement(
  grid: Uint8Array,
  dirGrid: Uint8Array,
  word: string,
  startRow: number,
  startCol: number,
  dir: WordDirection
): number {
  const dr = dir === 'V' ? 1 : 0;
  const dc = dir === 'H' ? 1 : 0;
  const perpDr = dc;
  const perpDc = dr;
  const len = word.length;
  const dirBit = dir === 'H' ? 1 : 2;

  const endRow = startRow + (len - 1) * dr;
  const endCol = startCol + (len - 1) * dc;

  if (
    startRow < 2 ||
    startCol < 2 ||
    endRow >= GRID_DIM - 2 ||
    endCol >= GRID_DIM - 2
  ) {
    return -1;
  }

  // Check end caps (must be empty)
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
      // Non-intersecting cell: perpendicular neighbors must be empty
      const n1 = (r - perpDr) * GRID_DIM + (c - perpDc);
      const n2 = (r + perpDr) * GRID_DIM + (c + perpDc);
      if (grid[n1] !== 0 || grid[n2] !== 0) {
        return -1;
      }
    }
  }

  return intersections;
}

function applyWord(
  state: SearchState,
  word: string,
  row: number,
  col: number,
  dir: WordDirection
): Array<{ idx: number; prevLetter: number; prevDir: number }> {
  const dr = dir === 'V' ? 1 : 0;
  const dc = dir === 'H' ? 1 : 0;
  const dirBit = dir === 'H' ? 1 : 2;
  const undo: Array<{ idx: number; prevLetter: number; prevDir: number }> = [];

  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr;
    const c = col + i * dc;
    const idx = r * GRID_DIM + c;
    undo.push({
      idx,
      prevLetter: state.grid[idx],
      prevDir: state.dirGrid[idx],
    });
    state.grid[idx] = charIndex(word[i]) + 1;
    state.dirGrid[idx] |= dirBit;
  }

  state.placed.push({ word, row, col, direction: dir });
  state.usedWords.add(word);
  return undo;
}

function revertWord(
  state: SearchState,
  word: string,
  undo: Array<{ idx: number; prevLetter: number; prevDir: number }>
): void {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    state.grid[u.idx] = u.prevLetter;
    state.dirGrid[u.idx] = u.prevDir;
  }
  state.placed.pop();
  state.usedWords.delete(word);
}

function findValidPlacements(
  state: SearchState,
  word: string
): PlacementCandidate[] {
  const results: PlacementCandidate[] = [];
  const seen = new Set<number>();

  // Scan placed words to find matching anchor letters
  for (let p = 0; p < state.placed.length; p++) {
    const pw = state.placed[p];
    const targetDir: WordDirection = pw.direction === 'H' ? 'V' : 'H';
    const pDr = pw.direction === 'V' ? 1 : 0;
    const pDc = pw.direction === 'H' ? 1 : 0;
    const tDr = targetDir === 'V' ? 1 : 0;
    const tDc = targetDir === 'H' ? 1 : 0;

    for (let pi = 0; pi < pw.word.length; pi++) {
      const ch = pw.word[pi];
      const anchorR = pw.row + pi * pDr;
      const anchorC = pw.col + pi * pDc;

      for (let wi = 0; wi < word.length; wi++) {
        if (word[wi] !== ch) continue;
        const startR = anchorR - wi * tDr;
        const startC = anchorC - wi * tDc;
        const hash =
          ((startR * GRID_DIM + startC) << 1) | (targetDir === 'H' ? 0 : 1);
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
            intersections: inter,
          });
        }
      }
    }
  }

  return results;
}

function scoreLayout(placed: PlacedWord[], intersections: number): number {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const pw of placed) {
    const dr = pw.direction === 'V' ? 1 : 0;
    const dc = pw.direction === 'H' ? 1 : 0;
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

function buildGridForBaseWord(
  baseWord: string,
  candidates: DictEntry[],
  spec: DifficultySpec,
  budgetMs: number
): { placed: PlacedWord[]; score: number } | null {
  const startTime = performance.now();
  const targetCount =
    spec.minWords +
    Math.floor(Math.random() * (spec.maxWords - spec.minWords + 1));

  // Order candidate words: baseWord first, then tier-prioritized & varied length with randomness
  const pool = candidates
    .filter((e) => e.word !== baseWord && e.tier <= spec.maxGridTier)
    .map((e) => ({
      entry: e,
      weight:
        (4 - e.tier) * 10 +
        e.len * 2 +
        Math.random() * 14,
    }))
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.entry.word);

  // If easy/medium didn't have enough strict-tier words, append remaining subwords
  if (pool.length < spec.minWords + 4) {
    const extra = candidates
      .filter((e) => e.word !== baseWord && e.tier > spec.maxGridTier)
      .map((e) => e.word);
    shuffleInPlace(extra);
    pool.push(...extra);
  }

  const orderedWords = [baseWord, ...pool.slice(0, 48)];

  const state: SearchState = {
    grid: new Uint8Array(GRID_DIM * GRID_DIM),
    dirGrid: new Uint8Array(GRID_DIM * GRID_DIM),
    placed: [],
    usedWords: new Set(),
    intersections: 0,
  };

  // Place base word horizontally in center
  const firstDir: WordDirection = Math.random() < 0.7 ? 'H' : 'V';
  const startR =
    firstDir === 'H' ? GRID_CENTER : GRID_CENTER - Math.floor(baseWord.length / 2);
  const startC =
    firstDir === 'H' ? GRID_CENTER - Math.floor(baseWord.length / 2) : GRID_CENTER;
  applyWord(state, baseWord, startR, startC, firstDir);

  let bestPlaced: PlacedWord[] | null = null;
  let bestScore = -Infinity;
  let nodes = 0;

  function backtrack(poolIdx: number): void {
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

    // Try placing remaining words
    let triedWords = 0;
    for (let i = poolIdx; i < orderedWords.length && triedWords < 14; i++) {
      const w = orderedWords[i];
      if (state.usedWords.has(w)) continue;

      const placements = findValidPlacements(state, w);
      if (placements.length === 0) continue;

      triedWords++;
      // Sort placements by intersections desc + jitter
      placements.sort(
        (a, b) =>
          b.intersections - a.intersections + (Math.random() - 0.5) * 0.5
      );

      const branchLimit = Math.min(2, placements.length);
      for (let b = 0; b < branchLimit; b++) {
        const cand = placements[b];
        const undo = applyWord(state, cand.word, cand.row, cand.col, cand.direction);
        state.intersections += cand.intersections;

        backtrack(i + 1);

        state.intersections -= cand.intersections;
        revertWord(state, cand.word, undo);

        if (
          bestPlaced &&
          bestPlaced.length >= targetCount &&
          nodes > 120
        ) {
          return;
        }
        if (performance.now() - startTime > budgetMs) {
          return;
        }
      }
    }
  }

  backtrack(1);

  if (bestPlaced && (bestPlaced as PlacedWord[]).length >= spec.minWords) {
    return { placed: bestPlaced, score: bestScore };
  }
  return null;
}

export function generateCrossword(
  difficulty: Difficulty,
  dict: RussianDictionary = getDictionary()
): GeneratedCrossword {
  const startTime = performance.now();
  const spec = DIFFICULTY_SPECS[difficulty];
  const pool = dict.baseCandidates[difficulty];

  let bestResult: {
    baseWord: string;
    subwords: DictEntry[];
    placed: PlacedWord[];
    score: number;
  } | null = null;

  // Try up to 24 random base words within ~220ms budget
  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && performance.now() - startTime > 200) break;

    const candidate = pool[Math.floor(Math.random() * pool.length)];
    const subwords = dict.findSubwords(candidate.word);

    // Filter subwords matching allowed grid tier
    const tierFiltered = subwords.filter((s) => s.tier <= spec.maxGridTier);
    if (tierFiltered.length < spec.minSubwordsPool) continue;

    const layout = buildGridForBaseWord(candidate.word, subwords, spec, 45);
    if (!layout) continue;

    if (!bestResult || layout.score > bestResult.score) {
      bestResult = {
        baseWord: candidate.word,
        subwords,
        placed: layout.placed,
        score: layout.score,
      };
    }

    // Stop early if we got a strong layout meeting target word count
    if (layout.placed.length >= spec.minWords + 1) {
      break;
    }
  }

  // Deterministic safe fallback scan if random sampling got unlucky
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
          score: layout.score,
        };
        break;
      }
    }
  }

  if (!bestResult) {
    throw new Error(`Failed to generate crossword for difficulty=${difficulty}`);
  }

  // Normalize coordinates so minRow = 0, minCol = 0
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;

  for (const pw of bestResult.placed) {
    const dr = pw.direction === 'V' ? 1 : 0;
    const dc = pw.direction === 'H' ? 1 : 0;
    const r2 = pw.row + (pw.word.length - 1) * dr;
    const c2 = pw.col + (pw.word.length - 1) * dc;
    if (pw.row < minRow) minRow = pw.row;
    if (r2 > maxRow) maxRow = r2;
    if (pw.col < minCol) minCol = pw.col;
    if (c2 > maxCol) maxCol = c2;
  }

  const normalizedPlaced: PlacedWord[] = bestResult.placed.map((pw) => ({
    word: pw.word,
    row: pw.row - minRow,
    col: pw.col - minCol,
    direction: pw.direction,
  }));

  const gridWordSet = new Set(normalizedPlaced.map((pw) => pw.word));
  const bonusWords = bestResult.subwords
    .map((s) => s.word)
    .filter((w) => !gridWordSet.has(w));

  const wheelLetters = shuffleInPlace(bestResult.baseWord.split(''));

  return {
    difficulty,
    baseWord: bestResult.baseWord,
    wheelLetters,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    placedWords: normalizedPlaced,
    bonusWords,
    generationMs: Math.round((performance.now() - startTime) * 10) / 10,
  };
}

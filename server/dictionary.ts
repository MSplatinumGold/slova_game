import fs from 'node:fs';
import path from 'node:path';

export const RUSSIAN_ALPHABET = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';

const CHAR_TO_INDEX = new Map<string, number>();
for (let i = 0; i < RUSSIAN_ALPHABET.length; i++) {
  CHAR_TO_INDEX.set(RUSSIAN_ALPHABET[i], i);
}

export interface DictEntry {
  word: string;
  tier: 1 | 2 | 3;
  len: number;
  maskLo: number; // bits 0..30
  maskHi: number; // bits 31..32
  counts: Uint8Array;
}

export function charIndex(ch: string): number {
  return CHAR_TO_INDEX.get(ch) ?? -1;
}

export function isValidRussianWord(word: string): boolean {
  if (word.length < 3 || word.length > 10) return false;
  for (let i = 0; i < word.length; i++) {
    if (!CHAR_TO_INDEX.has(word[i])) return false;
  }
  return true;
}

export function normalizeInputWord(raw: string): string {
  return raw.trim().toLowerCase();
}

export function computeWordSignature(word: string): {
  maskLo: number;
  maskHi: number;
  counts: Uint8Array;
} {
  let maskLo = 0;
  let maskHi = 0;
  const counts = new Uint8Array(33);
  for (let i = 0; i < word.length; i++) {
    const idx = CHAR_TO_INDEX.get(word[i]);
    if (idx === undefined) continue;
    counts[idx]++;
    if (idx < 31) {
      maskLo |= 1 << idx;
    } else {
      maskHi |= 1 << (idx - 31);
    }
  }
  return { maskLo, maskHi, counts };
}

export class RussianDictionary {
  public readonly entries: DictEntry[] = [];
  public readonly wordMap = new Map<string, DictEntry>();
  public readonly baseCandidates: {
    easy: DictEntry[];
    medium: DictEntry[];
    hard: DictEntry[];
  } = {
    easy: [],
    medium: [],
    hard: [],
  };

  constructor(jsonPath?: string) {
    const resolvedPath =
      jsonPath ?? path.resolve(process.cwd(), 'server/data/russian_nouns.json');
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw) as Array<{ w: string; t: 1 | 2 | 3 }>;

    for (const item of parsed) {
      const w = item.w;
      if (!isValidRussianWord(w)) continue;
      if (this.wordMap.has(w)) continue;

      const { maskLo, maskHi, counts } = computeWordSignature(w);
      const entry: DictEntry = {
        word: w,
        tier: item.t,
        len: w.length,
        maskLo,
        maskHi,
        counts,
      };
      this.entries.push(entry);
      this.wordMap.set(w, entry);

      // Partition base word pools by difficulty
      // Easy: 4-5 letters, frequent (tier 1)
      if (entry.len >= 4 && entry.len <= 5 && entry.tier === 1) {
        this.baseCandidates.easy.push(entry);
      }
      // Medium: 6-7 letters, tier 1 or 2
      if (entry.len >= 6 && entry.len <= 7 && entry.tier <= 2) {
        this.baseCandidates.medium.push(entry);
      }
      // Hard: 7-9 letters, any tier (prefer words with <= 2 rare repeats, variety)
      if (entry.len >= 7 && entry.len <= 9) {
        this.baseCandidates.hard.push(entry);
      }
    }
  }

  public has(word: string): boolean {
    return this.wordMap.has(word);
  }

  /**
   * Returns all dictionary words formable from `baseWord`'s multiset of letters.
   * Strictly distinguishes 'е' and 'ё'.
   */
  public findSubwords(baseWord: string): DictEntry[] {
    const { maskLo, maskHi, counts } = computeWordSignature(baseWord);
    const invLo = ~maskLo;
    const invHi = ~maskHi;
    const maxLen = baseWord.length;
    const result: DictEntry[] = [];

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.len > maxLen) continue;
      if ((e.maskLo & invLo) !== 0 || (e.maskHi & invHi) !== 0) continue;

      // Exact multiset check only for unique chars in candidate word
      let ok = true;
      for (let j = 0; j < e.len; j++) {
        const ci = CHAR_TO_INDEX.get(e.word[j])!;
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
}

let singletonDict: RussianDictionary | null = null;

export function getDictionary(): RussianDictionary {
  if (!singletonDict) {
    singletonDict = new RussianDictionary();
  }
  return singletonDict;
}

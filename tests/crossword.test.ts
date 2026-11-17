import assert from 'node:assert/strict';
import { generateCrossword, type GeneratedCrossword } from '../server/crossword.ts';
import { getDictionary, isValidRussianWord } from '../server/dictionary.ts';
import type { Difficulty } from '../shared/types.ts';

function verifyCrosswordGeometry(cw: GeneratedCrossword): void {
  const dict = getDictionary();
  const cellLetter = new Map<string, string>();
  const cellDirs = new Map<string, Set<'H' | 'V'>>();

  // 1. Check all words are valid dictionary words and formable from wheelLetters
  const wheelCounts = new Map<string, number>();
  for (const ch of cw.wheelLetters) {
    wheelCounts.set(ch, (wheelCounts.get(ch) ?? 0) + 1);
  }

  for (const pw of cw.placedWords) {
    assert.ok(isValidRussianWord(pw.word), `Invalid word format: ${pw.word}`);
    assert.ok(dict.has(pw.word), `Word not in dictionary: ${pw.word}`);

    // Verify multiset containment (strictly distinguishing е and ё)
    const wCounts = new Map<string, number>();
    for (const ch of pw.word) {
      wCounts.set(ch, (wCounts.get(ch) ?? 0) + 1);
    }
    for (const [ch, cnt] of wCounts.entries()) {
      assert.ok(
        (wheelCounts.get(ch) ?? 0) >= cnt,
        `Word "${pw.word}" uses "${ch}" which is missing/insufficient in wheel [${cw.wheelLetters.join('')}]`
      );
    }

    const dr = pw.direction === 'V' ? 1 : 0;
    const dc = pw.direction === 'H' ? 1 : 0;
    for (let i = 0; i < pw.word.length; i++) {
      const r = pw.row + i * dr;
      const c = pw.col + i * dc;
      assert.ok(r >= 0 && r < cw.rows, `Row out of bounds: ${r}`);
      assert.ok(c >= 0 && c < cw.cols, `Col out of bounds: ${c}`);
      const key = `${r},${c}`;
      const existing = cellLetter.get(key);
      if (existing) {
        assert.equal(
          existing,
          pw.word[i],
          `Letter mismatch at ${key}: ${existing} vs ${pw.word[i]}`
        );
      }
      cellLetter.set(key, pw.word[i]);
      const dirs = cellDirs.get(key) ?? new Set<'H' | 'V'>();
      assert.ok(
        !dirs.has(pw.direction),
        `Same-direction overlap at ${key} for ${pw.word}`
      );
      dirs.add(pw.direction);
      cellDirs.set(key, dirs);
    }
  }

  // 2. Verify NO unintended orthogonal runs exist anywhere in the 2D grid
  const placedSet = new Set(cw.placedWords.map((p) => p.word));
  assert.equal(placedSet.size, cw.placedWords.length, 'Duplicate words in grid');

  // Every contiguous horizontal run of length >= 2 MUST correspond to an H placedWord
  for (let r = 0; r < cw.rows; r++) {
    let c = 0;
    while (c < cw.cols) {
      if (!cellLetter.has(`${r},${c}`)) {
        c++;
        continue;
      }
      const startC = c;
      let run = '';
      while (c < cw.cols && cellLetter.has(`${r},${c}`)) {
        run += cellLetter.get(`${r},${c}`);
        c++;
      }
      if (run.length >= 2) {
        const match = cw.placedWords.find(
          (p) =>
            p.direction === 'H' &&
            p.row === r &&
            p.col === startC &&
            p.word === run
        );
        assert.ok(
          match,
          `Invalid horizontal sequence "${run}" at (${r},${startC}) not matching a placed H word`
        );
      }
    }
  }

  // Every contiguous vertical run of length >= 2 MUST correspond to a V placedWord
  for (let c = 0; c < cw.cols; c++) {
    let r = 0;
    while (r < cw.rows) {
      if (!cellLetter.has(`${r},${c}`)) {
        r++;
        continue;
      }
      const startR = r;
      let run = '';
      while (r < cw.rows && cellLetter.has(`${r},${c}`)) {
        run += cellLetter.get(`${r},${c}`);
        r++;
      }
      if (run.length >= 2) {
        const match = cw.placedWords.find(
          (p) =>
            p.direction === 'V' &&
            p.row === startR &&
            p.col === c &&
            p.word === run
        );
        assert.ok(
          match,
          `Invalid vertical sequence "${run}" at (${startR},${c}) not matching a placed V word`
        );
      }
    }
  }

  // 3. Verify bonus words are disjoint from placed words and valid subwords
  for (const bw of cw.bonusWords) {
    assert.ok(!placedSet.has(bw), `Bonus word "${bw}" also in grid`);
    assert.ok(dict.has(bw), `Bonus word "${bw}" not in dictionary`);
  }
}

function runTests(): void {
  const dict = getDictionary();
  console.log(`Dictionary loaded: ${dict.entries.length} words`);
  assert.ok(
    dict.entries.length >= 10000 && dict.entries.length <= 25000,
    `Expected 10k-25k words, got ${dict.entries.length}`
  );

  // Test strict Е vs Ё distinction
  assert.ok(dict.has('ёлка'), 'ёлка must be in dictionary');
  assert.ok(!dict.has('елка'), 'елка must NOT be in dictionary (requires ё)');
  assert.ok(dict.has('мёд'), 'мёд must be in dictionary');
  assert.ok(!dict.has('мед'), 'мед must NOT be in dictionary (requires ё)');
  assert.ok(dict.has('самолёт'), 'самолёт must be in dictionary');
  assert.ok(!dict.has('самолет'), 'самолет must NOT be in dictionary');
  assert.ok(dict.has('ножницы'), 'ножницы (plurale tantum) must be in dictionary');

  // Verify subword search keeps е and ё separate
  const subNoYo = dict.findSubwords('домосед').map((e) => e.word);
  assert.ok(!subNoYo.includes('мёд'), 'домосед (only е) must NOT form мёд');
  const subWithYo = dict.findSubwords('самолёт').map((e) => e.word);
  assert.ok(subWithYo.includes('самолёт'), 'самолёт must form самолёт');
  assert.ok(!subWithYo.includes('лето'), 'самолёт has ё, not е, so cannot form лето');

  const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];
  const expectedRanges: Record<Difficulty, [number, number]> = {
    easy: [4, 7],
    medium: [7, 11],
    hard: [10, 15],
  };

  for (const diff of difficulties) {
    const times: number[] = [];
    const wordCounts: number[] = [];
    for (let i = 0; i < 15; i++) {
      const cw = generateCrossword(diff, dict);
      verifyCrosswordGeometry(cw);
      const [minW, maxW] = expectedRanges[diff];
      assert.ok(
        cw.placedWords.length >= minW && cw.placedWords.length <= maxW,
        `[${diff}] Expected ${minW}..${maxW} words, got ${cw.placedWords.length} (base: ${cw.baseWord})`
      );
      assert.ok(
        cw.generationMs < 350,
        `[${diff}] Generation too slow: ${cw.generationMs}ms`
      );
      times.push(cw.generationMs);
      wordCounts.push(cw.placedWords.length);
    }
    const avgMs = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
    const maxMs = Math.max(...times);
    console.log(
      `[${diff}] 15/15 valid | words: ${Math.min(...wordCounts)}-${Math.max(...wordCounts)} | avg: ${avgMs}ms | max: ${maxMs}ms`
    );
  }

  console.log('ALL CROSSWORD & DICTIONARY TESTS PASSED');
}

runTests();

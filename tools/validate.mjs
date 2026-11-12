// Checks every unit file. Run: npm run validate
//  - 12 units, 3 lessons (tests) each
//  - each lesson: 26 practice + 10 theory + 4 texts = 40, texts at positions 10/20/30/40
//  - valid item shapes, and every answer key grades as fully correct
import { UNITS } from '../data/units/index.js';
import { buildTest, SECTIONS, TEST_SIZE, PAGE_SIZE } from '../js/content.js';
import { gradeItem, keyAnswer, gapCount, MANUAL_TYPES } from '../js/grading.js';

const TYPES = new Set(['choice', 'gap', 'fix', 'order', 'match', 'tf', 'stress', 'reading', 'speak', 'write']);
const TYPED = new Set(['gap', 'fix', 'write']);
const errors = [];
const typeCount = {};
const secCount = {};
let total = 0;
let typed = 0;
const codes = new Set();

if (UNITS.length !== 12) errors.push(`Expected 12 units, found ${UNITS.length}`);

for (const unit of UNITS) {
  for (const k of ['unit', 'title', 'color', 'topics', 'lessons']) if (unit[k] == null) errors.push(`Unit ${unit.unit}: missing ${k}`);
  if (unit.lessons?.length !== 3) errors.push(`Unit ${unit.unit}: ${unit.lessons?.length} lessons (need 3)`);

  for (const lesson of unit.lessons || []) {
    const L = `Lesson ${lesson.code}`;
    if (codes.has(lesson.code)) errors.push(`${L}: duplicate code`);
    codes.add(lesson.code);
    if (!/^\d{1,2}[A-Z]$/.test(lesson.code)) errors.push(`${L}: code must look like "1A"`);
    for (const [k, n] of Object.entries(TEST_SIZE)) {
      if (lesson[k]?.length !== n) errors.push(`${L}: ${k} has ${lesson[k]?.length} items (need ${n})`);
    }
    const entries = buildTest(lesson);
    entries.forEach((e) => {
      if ((e.num % PAGE_SIZE === 0) !== (e.kind === 'text')) errors.push(`${L} #${e.num}: texts must be exactly at every ${PAGE_SIZE}th position`);
    });

    for (const e of entries) {
      const { item } = e;
      const err = (m) => errors.push(`${L} ${e.id} (#${e.num}, ${item.type}): ${m}`);
      total++;
      if (TYPED.has(item.type)) typed++;
      typeCount[item.type] = (typeCount[item.type] || 0) + 1;
      secCount[e.kind] = (secCount[e.kind] || 0) + 1;
      if (!SECTIONS[e.kind]) err(`unknown section "${e.kind}"`);
      if (!TYPES.has(item.type)) { err('unknown type'); continue; }
      if (!item.q) err('missing q');
      if (e.kind === 'text') {
        const text = item.text || '';
        if (!['reading', 'tf', 'gap'].includes(item.type)) err('a text item must be reading, tf or gap');
        if (text.length < 90) err(`text is too short (${text.length} chars)`);
      }

      switch (item.type) {
        case 'choice':
          if (!Array.isArray(item.options) || item.options.length < 2) err('needs options');
          if (!(item.answer >= 0 && item.answer < item.options.length)) err('answer out of range');
          if (new Set(item.options).size !== item.options.length) err('duplicate options');
          break;
        case 'gap':
          if (!Array.isArray(item.answer)) err('answer must be an array');
          else if (gapCount(item.text) !== item.answer.length) err(`text has ${gapCount(item.text)} gaps, answer has ${item.answer.length}`);
          break;
        case 'order':
          if (!Array.isArray(item.words)) err('needs words');
          else if (keyAnswer(item).includes(-1)) err('answer uses a word that is not in words');
          else if (keyAnswer(item).length !== item.words.length) err('not all words are used in the answer');
          break;
        case 'match':
          if (!Array.isArray(item.pairs) || item.pairs.length < 2) err('needs pairs');
          else if (new Set(item.pairs.map((p) => p[1])).size !== item.pairs.length) err('duplicate right side');
          break;
        case 'tf':
          if (!item.statements?.length) err('needs statements');
          if (item.statements?.some((s) => typeof s[1] !== 'boolean')) err('statement value must be true/false');
          break;
        case 'stress':
          if (!(item.answer >= 0 && item.answer < item.word.length)) err('answer out of range');
          break;
        case 'reading':
          if (!item.text || !item.questions?.length) err('needs text and questions');
          item.questions?.forEach((q, i) => { if (!(q.answer >= 0 && q.answer < q.options.length)) err(`question ${i + 1}: answer out of range`); });
          break;
        case 'fix':
          if (!item.text || !item.answer) err('needs text and answer');
          break;
      }

      if (!MANUAL_TYPES.has(item.type)) {
        const g = gradeItem(item, keyAnswer(item));
        if (g.points !== 1) err(`answer key grades as ${g.points}, expected 1`);
        if (gradeItem(item, undefined).points !== 0) err('empty answer should grade as 0');
      }
    }
  }
}

console.log(`Units: ${UNITS.length} · tests: ${codes.size} · items: ${total} · typed answers: ${typed} (${Math.round((typed / total) * 100)}%)`);
console.log('By type:', typeCount);
console.log('By section:', secCount);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n` + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log('\nAll units are valid.');

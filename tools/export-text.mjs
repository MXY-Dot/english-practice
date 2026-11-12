// Prints every item as one readable line (question → answer key), for proofreading.
//   node tools/export-text.mjs 3      → unit 3 only
//   node tools/export-text.mjs        → all units
import { UNITS } from '../data/units/index.js';
import { keyText } from '../js/grading.js';

const only = process.argv[2] ? Number(process.argv[2]) : null;
const flat = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' / ');
const sayText = (say) => (typeof say === 'string' ? say : say.map(([s, t]) => `${s}: ${t}`).join(' | '));

for (const unit of UNITS) {
  if (only && unit.unit !== only) continue;
  for (const lesson of unit.lessons) {
    console.log(`\n=== ${lesson.code} ${lesson.title} — ${lesson.topics}`);
    const groups = [['p', lesson.practice], ['t', lesson.theory], ['x', lesson.texts]];
    for (const [g, items] of groups) {
      items.forEach((it, i) => {
        const id = `${g}${i + 1}`;
        const parts = [`${id} [${it.type}${it.sec ? ':' + it.sec : ''}] ${flat(it.q)}`];
        if (it.say) parts.push(`AUDIO «${sayText(it.say)}»`);
        if (it.title) parts.push(`TITLE ${it.title}`);
        if (it.text) parts.push(`TEXT ${flat(it.text)}`);
        if (it.type === 'choice') parts.push(`OPTS ${it.options.map((o, k) => `${'abcdef'[k]}) ${o}`).join('  ')}`);
        if (it.type === 'order') parts.push(`WORDS ${it.words.join(' · ')}`);
        if (it.type === 'match') parts.push(`PAIRS ${it.pairs.map(([l, r]) => `${l}=${r}`).join('; ')}`);
        if (it.type === 'tf') parts.push(`STMTS ${it.statements.map(([s, v]) => `${s} (${v ? 'T' : 'F'})`).join('; ')}`);
        if (it.type === 'reading') parts.push(`QS ${it.questions.map((q) => `${q.q} [${q.options.join(' | ')}] → ${q.options[q.answer]}`).join('; ')}`);
        if (it.type === 'speak') parts.push(`MODEL ${it.model}`);
        if (it.type === 'write') parts.push(`(min ${it.minWords} words)${it.hint ? ' HINT ' + flat(it.hint) : ''}`);
        if (!['match', 'tf', 'reading', 'speak', 'write'].includes(it.type)) parts.push(`→ ${keyText(it)}`);
        console.log(parts.join(' ‖ '));
      });
    }
  }
}

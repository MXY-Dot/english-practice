// Pure grading logic. No DOM here, so it can be tested in Node (see tools/).

// Item types the teacher has to grade by hand.
export const MANUAL_TYPES = new Set(['speak', 'write']);

const CONTRACTIONS = [
  [/\b(he|she|it|that|what|where|who|there|here|how|when)'s\b/g, '$1 is'],
  [/\bi'm\b/g, 'i am'],
  [/\b(you|we|they|who|what)'re\b/g, '$1 are'],
  [/\b(i|you|we|they|who)'ve\b/g, '$1 have'],
  [/\b(i|you|he|she|it|we|they)'ll\b/g, '$1 will'],
  [/\b(i|you|he|she|it|we|they)'d\b/g, '$1 would'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\b(is|are|was|were|do|does|did|has|have|had|could|would|should|must)n't\b/g, '$1 not'],
];

// Lower-case, unify quotes and spaces, drop final punctuation and commas.
// Unless `strict`, contractions are expanded so "I'm" and "I am" match.
export function normalize(s, strict = false) {
  let t = String(s ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!strict) for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t.replace(/\s+/g, ' ').trim();
}

const alts = (a) => (Array.isArray(a) ? a : [a]);
const matches = (given, accepted, strict) =>
  given != null && String(given).trim() !== '' &&
  alts(accepted).some((a) => normalize(a, strict) === normalize(given, strict));

export function gapCount(text) {
  return (String(text).match(/___/g) || []).length;
}

// Returns { points, max } where points is 0..1, or null when a teacher must grade it.
export function gradeItem(item, ans) {
  const max = 1;
  // Nothing to check when a manual task was left empty: it scores 0.
  if (MANUAL_TYPES.has(item.type)) return { points: isAnswered(item, ans) ? null : 0, max };
  if (ans == null) return { points: 0, max };
  switch (item.type) {
    case 'choice':
    case 'stress':
      return { points: ans === item.answer ? 1 : 0, max };
    case 'gap': {
      const ok = item.answer.filter((acc, i) => matches(ans[i], acc, item.strict)).length;
      return { points: ok / item.answer.length, max };
    }
    case 'fix':
      return { points: matches(ans, item.answer, item.strict) ? 1 : 0, max };
    case 'order': {
      const sentence = (ans || []).map((i) => item.words[i]).join(' ');
      return { points: matches(sentence, item.answer, item.strict) ? 1 : 0, max };
    }
    case 'match': {
      const ok = item.pairs.filter((_, i) => ans[i] === i).length;
      return { points: ok / item.pairs.length, max };
    }
    case 'tf': {
      const ok = item.statements.filter(([, v], i) => ans[i] === v).length;
      return { points: ok / item.statements.length, max };
    }
    case 'reading': {
      const ok = item.questions.filter((q, i) => ans[i] === q.answer).length;
      return { points: ok / item.questions.length, max };
    }
    default:
      return { points: 0, max };
  }
}

// The ideal answer for an item, in the same shape the UI stores. Used by tests
// to prove every answer key is reachable.
export function keyAnswer(item) {
  switch (item.type) {
    case 'choice':
    case 'stress':
      return item.answer;
    case 'gap':
      return item.answer.map((a) => alts(a)[0]);
    case 'fix':
      return alts(item.answer)[0];
    case 'order': {
      // Chips can be phrases ("get up"), so consume the target greedily, chip by chip.
      let rest = normalize(alts(item.answer)[0], item.strict);
      const used = new Set();
      const out = [];
      while (rest) {
        const i = item.words.findIndex((x, j) => {
          const w = normalize(x, item.strict);
          return !used.has(j) && (rest === w || rest.startsWith(w + ' '));
        });
        if (i < 0) return [...out, -1];
        used.add(i);
        out.push(i);
        rest = rest.slice(normalize(item.words[i], item.strict).length).trim();
      }
      return out;
    }
    case 'match':
      return item.pairs.map((_, i) => i);
    case 'tf':
      return item.statements.map(([, v]) => v);
    case 'reading':
      return item.questions.map((q) => q.answer);
    default:
      return null;
  }
}

// Human-readable answer key for teachers and graded results.
export function keyText(item) {
  switch (item.type) {
    case 'choice':
      return item.options[item.answer];
    case 'stress':
      return item.word.map((s, i) => (i === item.answer ? s.toUpperCase() : s)).join('');
    case 'gap':
      return item.answer.map((a) => alts(a).join(' / ')).join(' | ');
    case 'fix':
    case 'order':
      return alts(item.answer).join(' / ');
    case 'match':
      return item.pairs.map(([l, r]) => `${l} → ${r}`).join('; ');
    case 'tf':
      return item.statements.map(([, v], i) => `${i + 1}) ${v ? 'True' : 'False'}`).join('  ');
    case 'reading':
      return item.questions.map((q, i) => `${i + 1}) ${q.options[q.answer]}`).join('  ');
    case 'speak':
      return item.model || '';
    default:
      return '';
  }
}

// Final points for one item: the teacher's override wins over the auto grade.
export function itemPoints(item, ans, rev) {
  if (rev && typeof rev.points === 'number') return rev.points;
  return gradeItem(item, ans).points;
}

// Totals for a whole unit. `entries` come from flattenUnit().
export function scoreUnit(entries, answers = {}, review = {}) {
  let auto = 0, total = 0, pending = 0, answered = 0;
  for (const { id, item } of entries) {
    const ans = answers[id];
    if (isAnswered(item, ans)) answered++;
    const g = gradeItem(item, ans);
    if (g.points != null) auto += g.points;
    const p = itemPoints(item, ans, review[id]);
    if (p == null) pending++;
    else total += p;
  }
  const max = entries.length;
  return { auto: round(auto), total: round(total), max, pending, answered, percent: Math.round((total / max) * 100) };
}

export function isAnswered(item, ans) {
  if (ans == null) return false;
  switch (item.type) {
    case 'gap':
      return ans.some((x) => x && String(x).trim());
    case 'fix':
    case 'write':
      return String(ans).trim() !== '';
    case 'order':
      return ans.length > 0;
    case 'match':
    case 'tf':
    case 'reading':
      return ans.some((x) => x != null);
    case 'speak':
      return !!ans.audio;
    default:
      return true;
  }
}

// 5-point school scale suggestion from a percentage.
export function suggestGrade(percent) {
  if (percent >= 90) return 5;
  if (percent >= 75) return 4;
  if (percent >= 55) return 3;
  return 2;
}

const round = (n) => Math.round(n * 100) / 100;

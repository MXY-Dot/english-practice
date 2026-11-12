// Short constructors for exercise items, so unit files stay readable.
// Every helper returns a plain item object (see CLAUDE.md for the item shapes).
// The last argument `x` adds extra fields, e.g. { say: 'text for audio' }.

// Multiple choice.
export const ch = (q, options, answer, x) => ({ type: 'choice', q, options, answer, ...x });

// Listening multiple choice: the audio is played, then the student picks an answer.
export const lch = (say, q, options, answer) => ({ type: 'choice', q, options, answer, say });

// "Which word has a different sound?" — each option gets a play button.
export const odd = (q, options, answer) => ({ type: 'choice', q, options, answer, sayOptions: true });

// Gap fill: one answer per ___ ; an array inside gives alternatives for that gap.
export const gap = (q, text, ...answer) => ({ type: 'gap', q, text, answer });

// Listening gap fill.
export const lgap = (say, q, text, ...answer) => ({ type: 'gap', q, text, answer, say });

// Rewrite the wrong sentence.
export const fix = (text, ...answer) => ({ type: 'fix', q: 'Correct the mistake. Write the correct sentence.', text, answer });

// Transform a sentence (negative, question…): typed answer.
export const tr = (q, text, ...answer) => ({ type: 'fix', q, text, answer });

// Word order. `words` is split on "|" when present (for phrase chips), otherwise on spaces.
export const ord = (words, answer, q = 'Put the words in the correct order.') => ({
  type: 'order', q, words: words.includes('|') ? words.split('|').map((w) => w.trim()) : words.split(' '), answer,
});

export const mt = (q, pairs, x) => ({ type: 'match', q, pairs, ...x });

// True / false, optional text.
export const tf = (q, text, statements, x) => ({ type: 'tf', q, text, statements, ...x });

// Word stress: 'Sa-tur-day', index of the stressed syllable.
export const st = (word, answer, q = 'Listen. Which syllable is stressed?') => ({ type: 'stress', q, word: word.split('-'), answer });

export const sp = (q, model) => ({ type: 'speak', q, model });
export const wr = (q, minWords, hint) => ({ type: 'write', q, minWords, hint });

// Short text with multiple-choice questions: qs = [[question, options, answerIndex], …]
export const rd = (title, text, qs, q = 'Read the text and answer the questions.') => ({
  type: 'reading', q, title, text, questions: qs.map(([qq, options, answer]) => ({ q: qq, options, answer })),
});

// Short text with gaps to complete (cloze).
export const cloze = (title, text, ...answer) => ({ type: 'gap', q: 'Read the text and complete the gaps.', title, text, answer });

// Strict matching: contractions are NOT expanded ("I'm" ≠ "I am"). Use for contraction tasks.
export const strict = (item) => ({ ...item, strict: true });

// Tag a group of items with a section (grammar, vocabulary, pronunciation, listening, speaking, writing, practical).
export const sec = (name, items) => items.map((it) => ({ ...it, sec: name }));

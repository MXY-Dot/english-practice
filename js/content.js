// Turns unit files (data/units/*.js) into tests.
// Each lesson (1A, 1B, 1C, …) is one test of 40 items:
//   26 practice items + 10 grammar-theory items, mixed in a fixed pseudo-random order,
//   and 4 short texts placed at positions 10, 20, 30 and 40.
import { seededShuffle } from './ui.js';

export const SECTIONS = {
  grammar: { label: 'Grammar', color: '#4f7cff' },
  vocabulary: { label: 'Vocabulary', color: '#22a06b' },
  pronunciation: { label: 'Pronunciation', color: '#a35ee8' },
  listening: { label: 'Listening', color: '#f08a24' },
  speaking: { label: 'Speaking', color: '#e5508f' },
  writing: { label: 'Writing', color: '#e5484d' },
  practical: { label: 'Practical English', color: '#6c5ce7' },
  theory: { label: 'Grammar theory', color: '#0f9fb5' },
  text: { label: 'Text', color: '#c27c0e' },
};

export const TEST_SIZE = { practice: 26, theory: 10, texts: 4 };
export const PAGE_SIZE = 10;

// Item ids are stable per group: p1…p26 (practice), t1…t10 (theory), x1…x4 (texts).
// Editing an item keeps its id; inserting or removing items inside a group shifts the
// ids after it and breaks saved answers for tests already started.
export function buildTest(lesson) {
  const pool = [
    ...lesson.practice.map((item, i) => ({ id: 'p' + (i + 1), item, kind: item.sec || 'grammar' })),
    ...lesson.theory.map((item, i) => ({ id: 't' + (i + 1), item, kind: 'theory' })),
  ];
  const mixed = seededShuffle(pool, lesson.code);
  const texts = lesson.texts.map((item, i) => ({ id: 'x' + (i + 1), item, kind: 'text' }));
  const out = [];
  while (mixed.length || texts.length) {
    const pos = out.length + 1;
    if ((pos % PAGE_SIZE === 0 || !mixed.length) && texts.length) out.push(texts.shift());
    else out.push(mixed.shift());
  }
  return out.map((e, i) => ({ ...e, num: i + 1 }));
}

// Flat list of all tests: [{ code, title, topics, unit, practice, theory, texts }]
export function allTests(units) {
  return units.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u })));
}

// Unit tests for js/grading.js. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, gradeItem, scoreUnit, suggestGrade, isAnswered } from '../js/grading.js';

test('normalize: case, spaces, final punctuation, curly quotes', () => {
  assert.equal(normalize('  Hello,   World!! '), 'hello world');
  assert.equal(normalize('I’m here.'), 'i am here');
});

test('normalize: contractions match full forms unless strict', () => {
  assert.equal(normalize("She isn't here"), normalize('She is not here'));
  assert.equal(normalize("I can't swim"), normalize('I cannot swim'));
  assert.equal(normalize("they're"), 'they are');
  assert.notEqual(normalize("I'm", true), normalize('I am', true));
});

test('normalize: possessive \'s on nouns is kept', () => {
  assert.equal(normalize("Anna's car"), "anna's car");
});

test('gap: alternatives and partial credit', () => {
  const item = { type: 'gap', text: '___ and ___', answer: [['is', "'s"], 'are'] };
  assert.equal(gradeItem(item, ['is', 'are']).points, 1);
  assert.equal(gradeItem(item, ["'s", 'x']).points, 0.5);
  assert.equal(gradeItem(item, []).points, 0);
});

test('order: joins chosen word indices', () => {
  const item = { type: 'order', words: ['name', 'My', 'is', 'Ann'], answer: 'My name is Ann' };
  assert.equal(gradeItem(item, [1, 0, 2, 3]).points, 1);
  assert.equal(gradeItem(item, [0, 1, 2, 3]).points, 0);
});

test('manual types: null (teacher grades) when answered, 0 when empty', () => {
  assert.equal(gradeItem({ type: 'write' }, 'text').points, null);
  assert.equal(gradeItem({ type: 'speak' }, { audio: 'x' }).points, null);
  assert.equal(gradeItem({ type: 'write' }, '  ').points, 0);
  assert.equal(gradeItem({ type: 'speak' }, undefined).points, 0);
});

test('scoreUnit: teacher override wins, pending counted', () => {
  const entries = [
    { id: 'q1', item: { type: 'choice', options: ['a', 'b'], answer: 0 } },
    { id: 'q2', item: { type: 'choice', options: ['a', 'b'], answer: 0 } },
    { id: 'q3', item: { type: 'write' } },
  ];
  const answers = { q1: 0, q2: 1, q3: 'hello' };
  let s = scoreUnit(entries, answers, {});
  assert.deepEqual([s.auto, s.total, s.pending, s.answered], [1, 1, 1, 3]);
  s = scoreUnit(entries, answers, { q2: { points: 0.5 }, q3: { points: 1 } });
  assert.deepEqual([s.total, s.pending], [2.5, 0]);
});

test('isAnswered', () => {
  assert.equal(isAnswered({ type: 'gap' }, ['', ' ']), false);
  assert.equal(isAnswered({ type: 'choice' }, 0), true);
  assert.equal(isAnswered({ type: 'speak' }, {}), false);
});

test('suggestGrade thresholds', () => {
  assert.deepEqual([95, 80, 60, 40].map(suggestGrade), [5, 4, 3, 2]);
});

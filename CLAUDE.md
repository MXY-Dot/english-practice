# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static student/teacher practice site for an Elementary English course (topics follow English File 4th Edition Elementary). There are 12 units with 3 lessons each (1A, 1B, 1C … 12C). **Each lesson is one test of 40 items**: 26 practice items + 10 grammar-theory items in a fixed mixed order, plus 4 short texts at positions 10, 20, 30 and 40. Students answer and submit. Teachers review each item (override points, write a correction and a comment) and give a 2–5 grade or return the work. The UI text is Russian and the exercise text is English. The owner and users speak Russian.

Hosting target is **GitHub Pages**: no build step, no npm dependencies, plain ES modules loaded by the browser. Use only relative paths, because the site is served from `/<repo>/`.

## Commands

```bash
npm run serve      # static server on http://localhost:8080 (tools/serve.mjs)
npm test           # node:test unit tests for js/grading.js
npm run validate   # checks all content: 12 units × 3 lessons, 26/10/4 per lesson, texts at every 10th
                   # position, valid shapes, every answer key grades as 1
npm run check      # test + validate; run this after any content or grading change
npm run e2e        # headless Chrome/Edge via CDP, demo mode: opens all 36 tests, then a full
                   # student → teacher → student flow; screenshots go to tools/screenshots/
```

Run a single test: `node --test --test-name-pattern="order" tools/grading.test.mjs`.

## Architecture

- `index.html` → `js/main.js`: hash router (`#/login`, `#/test/1A`, `#/review/<id>`, `#/student/<id>`, `#/preview/1A`) and all views. The test page shows 10 items per page. Views rebuild the DOM with the `h()` helper in `js/ui.js`. User text is always added as text nodes, never `innerHTML`. `h()` sets `--css-vars` with `setProperty`, which colors depend on (`--uc` = unit color, `--sc` = section color).
- `js/content.js`: `buildTest(lesson)` turns a lesson into the ordered 40 entries. Practice and theory items are shuffled with `seededShuffle(…, lesson.code)`, so the order is the same on every device, and texts are placed at every 10th position. Item ids are **stable per group**: `p1…p26`, `t1…t10`, `x1…x4`. Inserting or removing an item inside a group shifts the ids after it and breaks saved answers.
- `js/store.js`: one data API with two backends, chosen by `js/config.js`:
  - **Supabase** (when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set). The client is loaded from jsDelivr ESM. Security lives in `supabase/schema.sql`: RLS policies, an `is_teacher()` helper, and a trigger that stops students writing `review/grade/teacher_comment`. Roles are changed only from the SQL editor.
  - **localStorage demo mode** (keys `efp_users`, `efp_subs2`, `efp_session`), with a teacher PIN.
  Any new store method must be added to **both** backends with the same return shape.
- One `submissions` row per (student, test code). Fields: `answers` (keyed by item id), `status` (`draft` → `submitted` → `graded`, or `returned` → back to the student), `review` (per item `{points, correction, comment}`), `grade`, `teacher_comment`. Voice recordings are stored inline as data URLs in `answers`.
- `js/grading.js` is pure (no DOM) and shared by the UI and the Node tools. `gradeItem` returns points from 0 to 1, or `null` for answered `speak` and `write` items, which the teacher grades (an empty one scores 0). A teacher override in `review[id].points` wins over the auto grade. `normalize()` ignores case, final punctuation and commas, and expands contractions (`isn't` = `is not`) unless the item has `strict: true`.
- `js/tasks.js` renders items in three modes: `do`, `review` and `result`. Click-based types (choice, stress, tf, reading, order) re-render their card on change so the selection shows at once. A choice whose question has `___` writes the chosen option into the blank. `/ʌ/`-style symbols in any text become 🔊 buttons (`richSounds` + `js/sounds.js`, which maps symbols to example words).
- `js/theme.js`: seasonal themes. It sets `<html data-season="winter|spring|summer|autumn|newyear" data-time="day|night">`. "Auto" picks the season from the date (newyear = 20 Dec – 14 Jan, with a light garland `#season-garland`) and night from 19:00 to 7:00, and is re-checked every 5 minutes. The setting is stored per device in localStorage (`efp_theme`). All colors in `css/style.css` must use the tokens (`--paper`, `--soft`, `--ink`, `--accent`…), never hard-coded `#fff`, or the night theme breaks. The decorative particles layer is `#season-fx`.
- `js/audio.js`: phrases and dialogues use browser `speechSynthesis` (a dialogue is `[[speaker, text], …]` and each speaker gets a different voice or pitch). **Single words** use real recordings from `api.dictionaryapi.dev` (UK preferred), with TTS as fallback. Recording uses `MediaRecorder` plus an optional `SpeechRecognition` transcript. Copyrighted book MP3s are deliberately not used or published.

## Unit content (`data/units/uNN.js`, registered in `data/units/index.js`)

```js
{ unit, title, color, topics, lessons: [
  { code: '1A', title, topics, practice: [26 items], theory: [10 items], texts: [4 items] }, … 3 lessons ] }
```

Write items with the helpers in `data/helpers.js` (`ch`, `lch`, `odd`, `gap`, `lgap`, `fix`, `tr`, `ord`, `mt`, `tf`, `st`, `sp`, `wr`, `rd`, `cloze`, `strict`). Wrap practice groups in `sec('grammar' | 'vocabulary' | 'pronunciation' | 'listening' | 'speaking' | 'writing', [...])`, which gives the colored tag. Theory items have no `sec`. Texts must be `rd`, `tf` (with text) or `cloze`, with at least 90 characters of text. Current practice mix per lesson: 9 grammar, 7 vocabulary, 4 pronunciation, 4 listening, 1 speaking, 1 writing. About 45% of items need typed answers (`gap`, `fix`, `tr`). Keep that share when adding content.

Item types: `choice` `{options, answer}`, `gap` `{text with ___, answer: [per gap: string | alternatives[]]}`, `fix` `{text, answer}`, `order` `{words, answer}` (chips can be phrases), `match` `{pairs}` (right sides unique), `tf` `{text?, statements: [[s, bool]]}`, `stress` `{word: [syllables], answer}`, `reading` `{title, text, questions}`, `speak` `{model}`, `write` `{minWords, hint}`. Any item can have `say` for an audio player.

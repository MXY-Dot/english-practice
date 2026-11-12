// Renders one exercise item in three modes:
//  'do'     – student answers (editable)
//  'review' – teacher checks: sees answer, key, can override points and comment
//  'result' – student sees the checked work (read-only)
import { h, rich, seededShuffle } from './ui.js';
import { speak, stopSpeaking, ttsSupported, startRecording, recordingSupported, playWord, isSingleWord, lookupWord } from './audio.js';
import { gradeItem, keyText, MANUAL_TYPES, gapCount } from './grading.js';
import { SECTIONS } from './content.js';
import { SOUNDS, SOUND_RE } from './sounds.js';

const LETTERS = 'abcdefghij';

// Types whose controls are buttons: re-render the card on change so the
// selection shows at once. Text inputs are not re-rendered (they would lose focus).
const CLICK_TYPES = new Set(['choice', 'stress', 'tf', 'reading', 'order']);

export function renderItem(entry, ctx) {
  const { id, num, item, kind } = entry;
  const editable = ctx.mode === 'do';
  const ans = ctx.answers[id];
  const rev = ctx.review?.[id];
  let card;
  const set = (v) => {
    ctx.onAnswer(id, v);
    if (CLICK_TYPES.has(item.type)) {
      try { navigator.vibrate?.(8); } catch {} // tiny haptic tick on phones
      const fresh = renderItem(entry, ctx);
      card.replaceWith(fresh);
      card = fresh;
    }
  };

  const meta = SECTIONS[kind] || SECTIONS.grammar;
  card = h('article', { class: 'item', id: 'item-' + id, 'data-type': item.type, style: { '--sc': meta.color } });
  card.append(
    h('div', { class: 'item-head' },
      h('span', { class: 'num' }, num),
      h('div', { class: 'item-main' },
        h('span', { class: 'tag' }, meta.label),
        h('div', { class: 'q' }, questionText(item, ans)))),
  );
  if (item.say) card.append(audioBar(item.say, ctx.mode !== 'do'));

  const body = RENDER[item.type]?.(item, ans, set, editable, id);
  card.append(h('div', { class: 'item-body' }, body ?? h('p', { class: 'muted' }, 'Неизвестный тип задания: ' + item.type)));

  if (ctx.mode !== 'do') card.append(feedback(entry, ans, rev, ctx));
  else if (rev && (rev.comment || rev.correction)) card.append(teacherNote(rev));
  return card;
}

// "Next" / Enter on the keyboard moves to the next typing field on the page.
const TEXT_FIELDS = '.lesson-body .gap-inp:not([disabled]), .lesson-body .fix .inp:not([disabled])';
function nextOnEnter(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const all = [...document.querySelectorAll(TEXT_FIELDS)];
  const next = all[all.indexOf(e.target) + 1];
  if (next) { next.focus(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else e.target.blur();
}

// ---------- text helpers ----------

// Question text; for a choice item the chosen option is written into its ___ gap.
function questionText(item, ans) {
  if (item.type !== 'choice' || !String(item.q).includes('___')) return richSounds(item.q);
  const frag = document.createDocumentFragment();
  String(item.q).split('___').forEach((part, i, arr) => {
    frag.append(richSounds(part));
    if (i < arr.length - 1) {
      frag.append(ans != null
        ? h('span', { class: 'filled' }, item.options[ans])
        : h('span', { class: 'blank' }, '      '));
    }
  });
  return frag;
}

// rich() plus clickable phonetic symbols: "/ʌ/" becomes a 🔊 chip with example words.
export function richSounds(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  const s = String(text ?? '');
  for (const m of s.matchAll(SOUND_RE)) {
    const examples = SOUNDS[m[1]];
    if (!examples) continue;
    frag.append(rich(s.slice(last, m.index)));
    frag.append(soundChip(m[1], examples));
    last = m.index + m[0].length;
  }
  frag.append(rich(s.slice(last)));
  return frag;
}

function soundChip(sym, examples) {
  let n = 0;
  return h('button', {
    type: 'button', class: 'sound-chip', title: 'Послушать звук: ' + examples.join(', '),
    onclick: (e) => { e.stopPropagation(); playWord(examples[n++ % examples.length]); },
  }, h('span', { class: 'ico' }, '🔊'), `/${sym}/`, h('small', null, 'as in ', examples[0]));
}

// ---------- shared pieces ----------

function audioBar(say, showTranscript) {
  const bar = h('div', { class: 'audio-bar' });
  if (!ttsSupported) {
    bar.append(h('span', { class: 'muted' }, 'Браузер не поддерживает озвучку. Откройте сайт в Chrome или Edge.'));
    return bar;
  }
  const play = (slow) => (e) => {
    const btn = e.currentTarget;
    btn.classList.add('playing');
    const onEnd = () => btn.classList.remove('playing');
    if (typeof say === 'string' && isSingleWord(say)) playWord(say, { slow, onEnd });
    else speak(say, { slow, onEnd });
    setTimeout(onEnd, 30000);
  };
  bar.append(
    h('button', { type: 'button', class: 'btn-audio', onclick: play(false) }, '▶ Listen'),
    h('button', { type: 'button', class: 'btn-audio slow', onclick: play(true) }, '🐢 Slowly'),
    h('button', { type: 'button', class: 'btn-audio stop', onclick: stopSpeaking, title: 'Stop' }, '■'),
  );
  if (showTranscript) {
    const lines = typeof say === 'string' ? [[null, say]] : say;
    bar.append(h('details', { class: 'transcript' }, h('summary', null, 'Текст аудио'),
      lines.map(([s, t]) => h('p', null, s ? h('b', null, s + ': ') : null, t))));
  }
  return bar;
}

// Single words use real recordings (dictionary API); phrases use TTS.
function sayBtn(text) {
  if (!ttsSupported && !isSingleWord(text)) return null;
  return h('button', { type: 'button', class: 'say', title: 'Listen', onclick: (e) => {
    e.stopPropagation();
    isSingleWord(text) ? playWord(text) : speak(text);
  } }, '🔊');
}

function teacherNote(rev) {
  return h('div', { class: 'teacher-note' },
    h('div', { class: 'tn-title' }, 'Комментарий учителя'),
    rev.correction ? h('div', null, h('b', null, 'Исправление: '), rev.correction) : null,
    rev.comment ? h('div', null, rev.comment) : null,
  );
}

function feedback(entry, ans, rev, ctx) {
  const { id, item } = entry;
  const auto = gradeItem(item, ans).points;
  const manual = MANUAL_TYPES.has(item.type);
  const final = rev && typeof rev.points === 'number' ? rev.points : auto;
  const box = h('div', { class: 'feedback' });

  const status = final == null ? 'pending' : final >= 1 ? 'ok' : final <= 0 ? 'bad' : 'part';
  const label = { pending: 'Ждёт проверки учителя', ok: 'Верно', bad: 'Неверно', part: 'Частично верно' }[status];
  box.classList.add(status);
  box.append(h('div', { class: 'fb-row' },
    h('span', { class: 'badge ' + status }, label),
    final != null ? h('span', { class: 'pts' }, `${fmtPts(final)} / 1`) : null,
    !manual && rev && typeof rev.points === 'number' && rev.points !== auto
      ? h('span', { class: 'muted small' }, `(авто: ${fmtPts(auto)})`) : null,
  ));

  const key = keyText(item);
  // The teacher grades without the key (they know the answers); the student sees it once graded;
  // the "all tasks with answers" preview passes showKey.
  const showKey = ctx.showKey || (ctx.mode === 'result' && ctx.status === 'graded');
  if (key && showKey && item.type !== 'write') {
    box.append(h('div', { class: 'key' }, h('b', null, item.type === 'speak' ? 'Образец: ' : 'Правильный ответ: '), key));
  }

  if (ctx.mode === 'review') box.append(reviewControls(id, rev, auto, ctx));
  else if (rev && (rev.comment || rev.correction)) box.append(teacherNote(rev));
  return box;
}

function reviewControls(id, rev = {}, auto, ctx) {
  const wrap = h('div', { class: 'review-ctl' });
  const current = typeof rev.points === 'number' ? rev.points : null;
  const choices = [[1, '✓ Верно'], [0.5, '½ Частично'], [0, '✗ Неверно']];
  const btns = h('div', { class: 'seg' });
  choices.forEach(([p, t]) => {
    btns.append(h('button', {
      type: 'button', class: 'seg-btn' + (current === p ? ' active' : ''),
      onclick: () => ctx.onReview(id, { points: current === p ? undefined : p }),
    }, t));
  });
  if (current != null && auto != null) {
    btns.append(h('button', { type: 'button', class: 'link', onclick: () => ctx.onReview(id, { points: undefined }) }, 'вернуть авто-оценку'));
  }
  wrap.append(btns);
  wrap.append(
    h('input', {
      class: 'inp', placeholder: 'Исправление (правильный вариант)…', value: rev.correction || '',
      oninput: (e) => ctx.onReview(id, { correction: e.target.value }, true),
    }),
    h('textarea', {
      class: 'inp', rows: 2, placeholder: 'Комментарий для ученика…', value: rev.comment || '',
      oninput: (e) => ctx.onReview(id, { comment: e.target.value }, true),
    }),
  );
  return wrap;
}

const fmtPts = (p) => (Math.round(p * 100) / 100).toString().replace('.', ',');

function passage(title, text, extra) {
  return h('div', { class: 'passage' },
    title ? h('h4', null, title) : null,
    String(text).split('\n').map((p) => h('p', null, rich(p))),
    extra);
}

// ---------- renderers per type ----------

const RENDER = {
  choice(item, ans, set, editable) {
    const correct = !editable ? item.answer : null;
    return h('div', { class: 'options' + (item.options.some((o) => o.length > 28) ? ' stacked' : '') },
      item.options.map((opt, i) => {
        const cls = ['opt'];
        if (ans === i) cls.push('selected');
        if (correct != null && ans === i) cls.push(i === correct ? 'right' : 'wrong');
        return h('div', { class: 'opt-wrap' },
          h('button', { type: 'button', class: cls.join(' '), disabled: !editable, onclick: () => set(i) },
            h('span', { class: 'letter' }, ans === i ? '✓' : LETTERS[i]), opt),
          item.sayOptions ? sayBtn(opt) : null);
      }));
  },

  gap(item, ans = [], set, editable, id) {
    const vals = Array.from({ length: gapCount(item.text) }, (_, i) => ans[i] ?? '');
    const box = h('div', { class: 'gap-wrap' });
    if (item.bank) box.append(h('div', { class: 'bank' }, seededShuffle(item.bank, id).map((w) => h('span', { class: 'chip' }, w))));
    let gi = 0;
    const lines = String(item.text).split('\n').map((line) => {
      const p = h('p', { class: 'gap-text' });
      line.split('___').forEach((part, i, arr) => {
        p.append(rich(part));
        if (i < arr.length - 1) {
          const k = gi++;
          const width = Math.max(5, ...[].concat(item.answer[k]).map((a) => String(a).length)) + 2;
          p.append(h('input', {
            class: 'gap-inp', value: vals[k], disabled: !editable, autocomplete: 'off', spellcheck: false,
            autocapitalize: 'off', placeholder: '…', style: { width: width + 'ch' }, enterKeyHint: 'next', onkeydown: nextOnEnter,
            oninput: (e) => { vals[k] = e.target.value; set(vals.slice()); },
          }));
        }
      });
      return p;
    });
    if (item.title || lines.length > 1) box.append(h('div', { class: 'passage' }, item.title ? h('h4', null, item.title) : null, lines));
    else box.append(...lines);
    return box;
  },

  fix(item, ans, set, editable) {
    return h('div', { class: 'fix' },
      h('p', { class: 'given-sentence' }, item.text),
      h('input', { class: 'inp', value: ans ?? '', disabled: !editable, placeholder: 'Напишите ответ здесь…', spellcheck: false, autocapitalize: 'off', enterKeyHint: 'next', onkeydown: nextOnEnter,
        oninput: (e) => set(e.target.value) }));
  },

  order(item, ans = [], set, editable, id) {
    const chosen = ans.slice();
    const pool = seededShuffle(item.words.map((w, i) => i), id);
    return h('div', { class: 'order' },
      h('div', { class: 'order-line' }, chosen.length
        ? chosen.map((wi, pos) => h('button', {
          type: 'button', class: 'chip on', disabled: !editable,
          onclick: () => { chosen.splice(pos, 1); set(chosen.slice()); },
        }, item.words[wi]))
        : h('span', { class: 'muted small' }, editable ? 'Нажимайте на слова по порядку' : '—')),
      h('div', { class: 'order-bank' }, pool.filter((wi) => !chosen.includes(wi)).map((wi) => h('button', {
        type: 'button', class: 'chip', disabled: !editable,
        onclick: () => { chosen.push(wi); set(chosen.slice()); },
      }, item.words[wi]))));
  },

  match(item, ans = [], set, editable, id) {
    const vals = item.pairs.map((_, i) => ans[i] ?? null);
    const rights = seededShuffle(item.pairs.map((_, i) => i), id);
    return h('div', { class: 'match' }, item.pairs.map(([left], i) => {
      const sel = h('select', {
        class: 'inp' + (vals[i] != null ? ' chosen' : ''), disabled: !editable,
        onchange: (e) => {
          vals[i] = e.target.value === '' ? null : Number(e.target.value);
          e.target.classList.toggle('chosen', vals[i] != null);
          set(vals.slice());
        },
      },
      h('option', { value: '' }, '— choose —'),
      rights.map((ri) => h('option', { value: String(ri), selected: vals[i] === ri }, item.pairs[ri][1])));
      const mark = !editable && vals[i] != null ? (vals[i] === i ? 'right' : 'wrong') : '';
      return h('div', { class: 'match-row ' + mark },
        h('span', { class: 'letter' }, i + 1), h('span', { class: 'match-left' }, left), sel);
    }));
  },

  tf(item, ans = [], set, editable) {
    const vals = item.statements.map((_, i) => ans[i] ?? null);
    const box = h('div', { class: 'tf' });
    if (item.text) box.append(passage(item.title, item.text));
    item.statements.forEach(([s, truth], i) => {
      const mk = (v, t) => {
        const cls = ['seg-btn'];
        if (vals[i] === v) cls.push('active');
        if (!editable && vals[i] === v) cls.push(v === truth ? 'right' : 'wrong');
        return h('button', { type: 'button', class: cls.join(' '), disabled: !editable,
          onclick: () => { vals[i] = v; set(vals.slice()); } }, t);
      };
      box.append(h('div', { class: 'tf-row' }, h('span', { class: 'letter' }, i + 1), h('span', { class: 'tf-s' }, s),
        h('div', { class: 'seg' }, mk(true, 'True'), mk(false, 'False'))));
    });
    return box;
  },

  stress(item, ans, set, editable) {
    const word = item.word.join('');
    const ipa = h('span', { class: 'ipa' });
    // The IPA shows the stress mark, so only reveal it after the work is submitted.
    if (!editable) lookupWord(word).then((info) => info?.ipa && (ipa.textContent = info.ipa));
    return h('div', { class: 'stress' },
      h('div', { class: 'syllables' }, item.word.map((syl, i) => {
        const cls = ['syl'];
        if (ans === i) cls.push('selected');
        if (!editable && ans === i) cls.push(i === item.answer ? 'right' : 'wrong');
        return h('button', { type: 'button', class: cls.join(' '), disabled: !editable, onclick: () => set(i) },
          ans === i ? h('span', { class: 'dot' }, '●') : null, syl);
      })),
      sayBtn(word), ipa);
  },

  reading(item, ans = [], set, editable) {
    const vals = item.questions.map((_, i) => ans[i] ?? null);
    return h('div', { class: 'reading' },
      passage(item.title, item.text),
      item.questions.map((q, qi) => h('div', { class: 'rq' },
        h('div', { class: 'rq-q' }, h('span', { class: 'letter' }, qi + 1), rich(q.q)),
        h('div', { class: 'options' }, q.options.map((o, oi) => {
          const cls = ['opt'];
          if (vals[qi] === oi) cls.push('selected');
          if (!editable && vals[qi] === oi) cls.push(oi === q.answer ? 'right' : 'wrong');
          return h('button', { type: 'button', class: cls.join(' '), disabled: !editable,
            onclick: () => { vals[qi] = oi; set(vals.slice()); } }, h('span', { class: 'letter' }, vals[qi] === oi ? '✓' : LETTERS[oi]), o);
        })))));
  },

  write(item, ans, set, editable) {
    const count = h('span', { class: 'muted small' });
    const upd = (v) => {
      const n = String(v || '').trim().split(/\s+/).filter(Boolean).length;
      count.textContent = `Слов: ${n}` + (item.minWords ? ` (нужно минимум ${item.minWords})` : '');
    };
    upd(ans);
    return h('div', { class: 'write' },
      item.hint ? h('p', { class: 'hint' }, rich(item.hint)) : null,
      h('textarea', { class: 'inp', rows: 6, value: ans ?? '', disabled: !editable, spellcheck: false, placeholder: 'Пишите здесь…',
        oninput: (e) => { upd(e.target.value); set(e.target.value); } }),
      count);
  },

  speak(item, ans, set, editable) {
    const wrap = h('div', { class: 'speak' });
    if (item.model) wrap.append(h('p', { class: 'model' }, h('span', null, rich(item.model)), sayBtn(item.model)));
    const player = h('div', { class: 'rec-result' });
    const showAns = (a) => {
      player.replaceChildren();
      if (a?.audio) {
        player.append(h('audio', { controls: true, src: a.audio, preload: 'none' }));
        if (a.transcript) player.append(h('p', { class: 'small muted' }, 'Распознано: «', a.transcript, '»'));
      } else if (!editable) player.append(h('span', { class: 'muted' }, 'Запись не сделана.'));
    };
    showAns(ans);
    if (editable) {
      if (!recordingSupported) {
        wrap.append(h('p', { class: 'muted' }, 'Запись голоса недоступна в этом браузере. Откройте сайт в Chrome по адресу https://…'));
      } else {
        let rec = null;
        const btn = h('button', { type: 'button', class: 'btn rec' }, ans?.audio ? '🎙 Записать заново' : '🎙 Записать');
        btn.onclick = async () => {
          if (!rec) {
            try {
              rec = await startRecording(item.maxSeconds ? item.maxSeconds * 1000 : 20000);
            } catch {
              alert('Нет доступа к микрофону. Разрешите доступ в настройках браузера.');
              return;
            }
            btn.textContent = '■ Остановить';
            btn.classList.add('recording');
            rec.done.then((res) => {
              rec = null;
              btn.textContent = '🎙 Записать заново';
              btn.classList.remove('recording');
              set(res);
              showAns(res);
            });
          } else rec.stop();
        };
        wrap.append(btn);
      }
    }
    wrap.append(player);
    return wrap;
  },
};

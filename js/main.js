import { CONFIG } from './config.js';
import { createStore } from './store.js';
import { UNITS } from '../data/units/index.js';
import { buildTest, allTests, PAGE_SIZE, TEST_SIZE } from './content.js';
import { h, clear, toast, fmtDate, debounce } from './ui.js';
import { renderItem, voiceNote, audioPill } from './tasks.js';
import { scoreUnit, suggestGrade, isAnswered } from './grading.js';
import { stopSpeaking } from './audio.js';
import { startThemeClock, themeButton } from './theme.js';

startThemeClock();

const app = document.getElementById('app');
const TESTS = allTests(UNITS);
const TEST_LEN = TEST_SIZE.practice + TEST_SIZE.theory + TEST_SIZE.texts;
const testByCode = (code) => TESTS.find((t) => t.code === code);
let store;
let user = null;

const STATUS = {
  none: { t: 'Не начат', c: 'st-none', icon: '○' },
  draft: { t: 'В процессе', c: 'st-draft', icon: '…' },
  submitted: { t: 'На проверке', c: 'st-submitted', icon: '!' },
  returned: { t: 'На доработке', c: 'st-returned', icon: '↺' },
  graded: { t: 'Проверен', c: 'st-graded', icon: '✓' },
};
const statusChip = (s) => h('span', { class: 'chip-st ' + STATUS[s || 'none'].c }, STATUS[s || 'none'].t);
const fmtNum = (n) => (n == null ? '—' : String(Math.round(n * 100) / 100).replace('.', ','));

// Small per-tab flags (e.g. a dismissed banner). Storage may be unavailable.
function sessionFlag(name, value) {
  try {
    if (value === undefined) return sessionStorage.getItem('efp-' + name) === '1';
    sessionStorage.setItem('efp-' + name, value ? '1' : '0');
  } catch { return false; }
}

// While the phone keyboard is open, the fixed bottom bar would cover the input.
const TYPING_FIELDS = 'input:not([type=checkbox]):not([type=file]), textarea';
document.addEventListener('focusin', (e) => { if (e.target.matches?.(TYPING_FIELDS)) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement?.matches?.(TYPING_FIELDS)) document.body.classList.remove('typing');
}, 50));

// Leave-page guard for unsaved work.
let pendingSave = null;
window.addEventListener('beforeunload', (e) => {
  if (pendingSave) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- boot & routing ----------

async function boot() {
  try {
    store = await createStore(CONFIG);
    user = await store.currentUser();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card error' },
      h('h2', null, 'Не удалось подключиться к базе данных'), h('p', null, e.message),
      h('p', null, 'Проверьте SUPABASE_URL и SUPABASE_ANON_KEY в js/config.js.'))));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

const go = (path) => (location.hash = '#' + path);

async function route() {
  stopSpeaking();
  if (pendingSave) await pendingSave.flush();
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (!user) return parts[0] === 'login' ? loginView() : go('/login');
  if (parts[0] === 'login') return go('/');
  try {
    if (user.role === 'teacher') {
      if (parts[0] === 'review' && parts[1]) return await reviewView(parts[1]);
      if (parts[0] === 'student' && parts[1]) return await studentProgressView(parts[1]);
      if (parts[0] === 'preview' && parts[1]) return await previewView(parts[1]);
      return await teacherHome();
    }
    if (parts[0] === 'test' && parts[1]) return await testView(parts[1]);
    return await studentHome();
  } catch (e) {
    console.error(e);
    shell(h('div', { class: 'card error' }, h('h2', null, 'Ошибка'), h('p', null, e.message)));
  }
}

function shell(...content) {
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, 'EP'), h('span', { class: 'brand-name' }, CONFIG.SITE_TITLE)),
    h('div', { class: 'who' },
      themeButton(),
      user ? [
        h('span', { class: 'role ' + user.role }, user.role === 'teacher' ? 'Учитель' : 'Ученик'),
        h('span', { class: 'who-name' }, user.name),
        h('button', { class: 'btn ghost small', onclick: logout, title: 'Выйти' }, 'Выйти'),
      ] : null));
  const banner = store?.mode === 'local'
    && !sessionFlag('hide-demo')
    ? h('div', { class: 'demo-banner' },
      h('span', null, '🧪 Демо-режим: данные хранятся только в этом браузере. Для работы с разных устройств подключите Supabase (см. README.md).'),
      h('button', { class: 'x', title: 'Скрыть', 'aria-label': 'Скрыть', onclick: (e) => { sessionFlag('hide-demo', true); e.currentTarget.parentElement.remove(); } }, '✕'))
    : null;
  app.replaceChildren(header, banner || '', h('main', { class: 'page' }, ...content));
}

async function logout() {
  if (pendingSave) await pendingSave.flush();
  await store.signOut();
  user = null;
  go('/login');
}

// ---------- login ----------

// Readable random password (no 0/O, 1/l/I look-alikes).
function makePassword(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  return Array.from(rnd, (n) => chars[n % chars.length]).join('');
}

// Password input with a 👁 show/hide button and an optional 🎲 generate button.
function passwordField(input, { generate = false } = {}) {
  const eye = h('button', { type: 'button', class: 'pw-btn', title: 'Показать пароль', 'aria-label': 'Показать пароль' }, '👁');
  const setVisible = (on) => {
    input.type = on ? 'text' : 'password';
    eye.textContent = on ? '🙈' : '👁';
    eye.title = on ? 'Скрыть пароль' : 'Показать пароль';
    eye.setAttribute('aria-label', eye.title);
  };
  eye.onclick = () => setVisible(input.type === 'password');
  const dice = h('button', { type: 'button', class: 'pw-btn', title: 'Придумать надёжный пароль', 'aria-label': 'Придумать пароль',
    onclick: async () => {
      input.value = makePassword();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setVisible(true);
      try { await navigator.clipboard.writeText(input.value); toast('Пароль придуман и скопирован. Запишите его!', 'ok'); } catch { toast('Пароль придуман. Запишите его!', 'ok'); }
    } }, '🎲');
  const wrap = h('div', { class: 'pw-wrap' }, input, h('div', { class: 'pw-tools' }, dice, eye));
  wrap.showGenerate = (on) => { dice.style.display = on ? '' : 'none'; };
  wrap.showGenerate(generate);
  return wrap;
}

function loginView() {
  const err = h('p', { class: 'form-error' });
  const fail = (e) => (err.textContent = e.message || String(e));
  const done = (u) => { user = u; go('/'); };
  let body;

  // Role switch shared by both modes.
  let role = 'student';
  const roleTabs = h('div', { class: 'seg wide' });
  const roleBtn = (r, label) => h('button', { type: 'button', class: 'seg-btn' + (r === role ? ' active' : ''), 'data-r': r, onclick: () => setRole(r) }, label);
  roleTabs.append(roleBtn('student', '🎒 Я ученик'), roleBtn('teacher', '🧑‍🏫 Я учитель'));
  let onRole = () => {};
  function setRole(r) {
    role = r;
    roleTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.r === r));
    onRole();
  }

  if (store.mode === 'local') {
    const name = h('input', { class: 'inp', placeholder: 'Имя и фамилия', autocomplete: 'username' });
    const pass = h('input', { class: 'inp', placeholder: 'Пароль (придумайте при первом входе)', type: 'password', autocomplete: 'current-password' });
    body = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); store.localLogin(name.value, role, pass.value).then(done, fail); } },
      roleTabs, name, passwordField(pass, { generate: true }), err, h('button', { class: 'btn primary', type: 'submit' }, 'Войти'),
      h('p', { class: 'muted small' }, 'Демо-режим. При первом входе аккаунт создаётся с этим паролем; потом входите с тем же паролем.'));
  } else {
    let mode = 'in';
    const name = h('input', { class: 'inp', placeholder: 'Имя и фамилия', autocomplete: 'name', style: { display: 'none' } });
    const email = h('input', { class: 'inp', placeholder: 'E-mail', type: 'email', autocomplete: 'email', required: true });
    const pass = h('input', { class: 'inp', placeholder: 'Пароль (минимум 6 символов)', type: 'password', autocomplete: 'current-password', required: true, minLength: 6 });
    const code = h('input', { class: 'inp', placeholder: 'Код учителя', type: 'password', autocomplete: 'off' });
    const passWrap = passwordField(pass);
    const codeWrap = passwordField(code);
    const roleWrap = h('div', { style: { display: 'none' } }, roleTabs);
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Войти');
    const hint = h('p', { class: 'muted small' });
    const tabs = h('div', { class: 'seg wide' });
    const sync = () => {
      const up = mode === 'up';
      name.style.display = up ? '' : 'none';
      roleWrap.style.display = up ? '' : 'none';
      codeWrap.style.display = up && role === 'teacher' ? '' : 'none';
      passWrap.showGenerate(up);
      pass.autocomplete = up ? 'new-password' : 'current-password';
      submit.textContent = up ? 'Зарегистрироваться' : 'Войти';
      hint.textContent = up
        ? (role === 'teacher' ? 'Придумайте пароль. Код учителя даёт владелец сайта.' : 'Придумайте пароль. После регистрации учитель добавит вас в свой класс.')
        : '';
    };
    onRole = sync;
    const setMode = (m) => {
      mode = m;
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.m === m));
      err.textContent = '';
      sync();
    };
    tabs.append(
      h('button', { type: 'button', class: 'seg-btn active', 'data-m': 'in', onclick: () => setMode('in') }, 'Вход'),
      h('button', { type: 'button', class: 'seg-btn', 'data-m': 'up', onclick: () => setMode('up') }, 'Регистрация'));
    body = h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        if (mode === 'up') {
          if (!name.value.trim()) throw new Error('Введите имя и фамилию.');
          if (role === 'teacher' && !code.value.trim()) throw new Error('Введите код учителя.');
          const u = await store.signUp({ name: name.value.trim(), email: email.value.trim(), password: pass.value, role, teacherCode: code.value.trim() });
          if (!u) { err.className = 'form-ok'; err.textContent = 'Мы отправили письмо для подтверждения. Подтвердите e-mail и войдите.'; setMode('in'); return; }
          done(u);
        } else {
          const u = await store.signIn(email.value.trim(), pass.value);
          if (!u) throw new Error('Профиль не найден.');
          done(u);
        }
      } catch (ex) { err.className = 'form-error'; fail(ex); } finally { submit.disabled = false; }
    } }, tabs, roleWrap, name, email, passWrap, codeWrap, err, submit, hint);
    sync();
  }

  app.replaceChildren(h('div', { class: 'login-page' },
    h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('div', { class: 'login-theme' }, themeButton()),
    h('div', { class: 'login-card' },
      h('div', { class: 'login-cover' },
        h('div', { class: 'cover-dots' }, UNITS.map((u) => h('span', { style: { background: u.color } }))),
        h('h1', null, CONFIG.SITE_TITLE),
        h('p', null, `${TESTS.length} уроков по ${TEST_LEN} заданий: грамматика, лексика, произношение, аудирование, тексты и теория.`)),
      body)));
}

// ---------- student ----------

function unitBlocks(subsByTest, linkFor) {
  return h('div', { class: 'unit-grid' }, UNITS.map((u) => h('section', { class: 'unit-card', style: { '--uc': u.color } },
    h('div', { class: 'uc-top' },
      h('span', { class: 'uc-num' }, u.unit),
      h('div', null, h('div', { class: 'uc-title' }, u.title), h('div', { class: 'uc-topics' }, u.topics))),
    h('div', { class: 'uc-tests' }, u.lessons.map((l) => {
      const s = subsByTest[l.code];
      const href = linkFor(l, s);
      const st = STATUS[s?.status || 'none'];
      return h(href ? 'a' : 'div', { class: 'test-row' + (href ? '' : ' disabled'), href },
        h('span', { class: 'tr-code' }, l.code),
        h('span', { class: 'tr-title' }, l.title),
        s?.grade ? h('span', { class: 'grade-pill' }, s.grade) : h('span', { class: 'tr-st ' + st.c, title: st.t }, st.icon));
    })))));
}

async function studentHome() {
  const subs = await store.listSubmissions(user.id);
  const byTest = Object.fromEntries(subs.map((s) => [s.test, s]));
  const graded = subs.filter((s) => s.status === 'graded').length;
  // Refresh: the teacher may have added this student after they logged in.
  user = (await store.currentUser()) || user;
  const teacher = user.teacher_id ? await store.teacherName(user.teacher_id) : '';
  shell(
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Привет, ', user.name.split(' ')[0], '! 👋'),
        h('p', { class: 'muted' }, `Выберите урок. В каждом уроке ${TEST_LEN} заданий вперемешку: практика, тексты и теория грамматики.`),
        h('p', { class: 'teacher-line' }, teacher
          ? ['🧑‍🏫 Ваш учитель: ', h('b', null, teacher)]
          : '⏳ Учитель ещё не добавил вас в свой класс. Задания можно делать уже сейчас — учитель увидит их, когда добавит вас.')),
      h('div', { class: 'hero-stats' },
        h('div', null, h('b', null, subs.length), h('small', null, 'начато')),
        h('div', null, h('b', null, graded), h('small', null, 'проверено')),
        h('div', null, h('b', null, TESTS.length), h('small', null, 'всего уроков')))),
    unitBlocks(byTest, (l) => '#/test/' + l.code));
}

async function testView(code) {
  const test = testByCode(code);
  if (!test) return go('/');
  const entries = buildTest(test);
  let sub = (await store.getSubmission(user.id, code)) || { student_id: user.id, test: code, answers: {}, status: 'draft', review: {} };
  sub.answers ||= {};
  const mode = ['draft', 'returned'].includes(sub.status) ? 'do' : 'result';

  const saveState = h('span', { class: 'save-state muted small' });
  const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }));
  // Tapping the counter jumps to the first unanswered item.
  const progressText = h('button', { type: 'button', class: 'jump-btn', onclick: () => {
    const next = entries.find((e) => !isAnswered(e.item, sub.answers[e.id]));
    if (next) pager?.goTo(next.id);
  } });
  let pager;
  const updProgress = () => {
    const done = entries.filter((e) => isAnswered(e.item, sub.answers[e.id])).length;
    progress.firstChild.style.width = (done / entries.length) * 100 + '%';
    const left = entries.length - done;
    progressText.textContent = left ? `${done}/${entries.length} · к пропущенному ↓` : `Все ${entries.length} выполнены ✓`;
    progressText.disabled = !left;
    pager?.refresh();
  };

  const doSave = async (status = sub.status) => {
    const sc = scoreUnit(entries, sub.answers);
    const payload = { ...sub, status, auto_score: sc.auto, max_score: sc.max };
    if (status === 'submitted') payload.submitted_at = new Date().toISOString();
    saveState.textContent = 'Сохранение…';
    try {
      const saved = await store.saveSubmission(payload);
      // Keep our own answers object: the page renders from it (ctx.answers). The server
      // returns a copy, and switching to it would make later clicks invisible.
      sub = { ...sub, ...saved, answers: sub.answers };
      saveState.textContent = '✓ Сохранено ' + fmtDate(saved.updated_at);
      return true;
    } catch (e) {
      saveState.textContent = 'Ошибка сохранения';
      toast(e.message, 'error');
      return false;
    } finally {
      if (pendingSave === saver) pendingSave = null;
    }
  };
  const saver = debounce(() => doSave(), 1200);
  const changed = () => { pendingSave = saver; saveState.textContent = 'Сохраняю…'; saver(); updProgress(); };

  const ctx = {
    mode, status: sub.status, answers: sub.answers, review: sub.review || {},
    onAnswer: (id, v) => { sub.answers[id] = v; changed(); },
  };

  const parts = [testHeader(test, [
    statusChip(sub.status),
    sub.grade ? h('span', { class: 'grade-big' }, 'Оценка: ', h('b', null, sub.grade)) : null,
  ])];
  if (sub.status === 'returned') parts.push(h('div', { class: 'notice warn' }, h('b', null, 'Работа возвращена на доработку. '), 'Исправьте задания с комментариями учителя и отправьте снова.'));
  const overall = sub.review?._overall || {};
  if ((sub.teacher_comment || overall.voice) && ['graded', 'returned'].includes(sub.status)) {
    parts.push(h('div', { class: 'notice teacher' },
      sub.teacher_comment ? [h('b', null, '💬 Учитель: '), sub.teacher_comment] : h('b', null, '💬 Учитель оставил голосовой комментарий:'),
      overall.voice ? h('div', { class: 'tn-voice' }, audioPill(overall.voice)) : null));
  }
  if (sub.status === 'graded') parts.push(scoreSummary(scoreUnit(entries, sub.answers, sub.review || {}), sub.grade));
  else if (sub.status === 'submitted') parts.push(h('div', { class: 'notice' }, '📨 Работа отправлена ', fmtDate(sub.submitted_at), '. Учитель скоро её проверит.'));

  pager = paged(test, entries, (e) => renderItem(e, ctx), mode === 'do' ? (e) => isAnswered(e.item, sub.answers[e.id]) : null);
  parts.push(pager.el);

  if (mode === 'do') {
    updProgress();
    const submitBtn = h('button', { class: 'btn primary', onclick: async () => {
      const sc = scoreUnit(entries, sub.answers);
      const missing = entries.length - sc.answered;
      const msg = missing ? `Не выполнено заданий: ${missing}. Всё равно отправить учителю?` : 'Отправить работу учителю? После отправки изменить ответы будет нельзя.';
      if (!confirm(msg)) return;
      saver.cancel();
      pendingSave = null;
      if (await doSave('submitted')) { toast('Работа отправлена учителю! 🎉', 'ok'); route(); }
    } }, 'Отправить', h('span', { class: 'hide-sm' }, ' учителю'));
    parts.push(h('div', { class: 'sticky-bar' }, h('div', { class: 'sb-left' }, progress, h('div', { class: 'sb-row' }, progressText, saveState)), submitBtn));
  }
  shell(...parts);
}

function testHeader(test, extra = []) {
  const u = test.unit;
  return h('section', { class: 'unit-header', style: { '--uc': u.color } },
    h('a', { class: 'back', href: '#/' }, '← Назад'),
    h('div', { class: 'uh-main' },
      h('div', { class: 'uh-num' }, h('small', null, 'UNIT ' + u.unit), test.code),
      h('div', null, h('h1', null, test.title), h('p', null, test.topics))),
    h('div', { class: 'uh-extra' }, extra));
}

// Splits the items into pages of 10 (each page ends with a text).
function paged(test, entries, renderEntry, isDone) {
  const wrap = h('section', { class: 'lessons', style: { '--uc': test.unit.color } });
  const tabs = h('nav', { class: 'page-tabs' });
  const body = h('div', { class: 'lesson-body' });
  const pages = [];
  for (let i = 0; i < entries.length; i += PAGE_SIZE) pages.push(entries.slice(i, i + PAGE_SIZE));
  let active = 0;
  try { active = Number(sessionStorage.getItem('page-' + test.code)) || 0; } catch {}
  if (active >= pages.length) active = 0;

  const tabBtns = pages.map((p, k) => h('button', { type: 'button', class: 'ptab', onclick: () => show(k, true) },
    h('b', null, `${p[0].num}–${p[p.length - 1].num}`), h('small', null, '')));
  tabs.append(...tabBtns);

  const refresh = () => tabBtns.forEach((b, k) => {
    b.classList.toggle('active', k === active);
    if (isDone) {
      const n = pages[k].filter(isDone).length;
      b.lastChild.textContent = `${n}/${pages[k].length}`;
      b.classList.toggle('complete', n === pages[k].length);
    }
  });

  function show(k, scroll, dir) {
    if (k < 0 || k >= pages.length) return;
    active = k;
    try { sessionStorage.setItem('page-' + test.code, String(k)); } catch {}
    clear(body);
    body.classList.remove('swipe-left', 'swipe-right');
    if (dir) { void body.offsetWidth; body.classList.add(dir > 0 ? 'swipe-left' : 'swipe-right'); }
    body.append(...pages[k].map(renderEntry));
    const nav = h('div', { class: 'page-nav' });
    if (k > 0) nav.append(h('button', { class: 'btn', onclick: () => show(k - 1, true, -1) }, '← Назад'));
    if (k < pages.length - 1) nav.append(h('button', { class: 'btn soft', onclick: () => show(k + 1, true, 1) }, `Дальше: ${pages[k + 1][0].num}–${pages[k + 1][pages[k + 1].length - 1].num} →`));
    body.append(nav);
    refresh();
    tabBtns[k].scrollIntoView?.({ block: 'nearest', inline: 'center' });
    if (scroll) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Swipe left/right on a phone to change page. Ignored when the swipe starts on
  // something that scrolls or is draggable, or when the gesture is mostly vertical.
  let sx = 0, sy = 0, st = 0, ok = false;
  body.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    ok = e.touches.length === 1 && !e.target.closest('input, textarea, select, audio, .order, .table-wrap, .syllables');
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  // A clearly horizontal drag is ours: stop the browser from treating it as "go back".
  body.addEventListener('touchmove', (e) => {
    if (!ok) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.8 && e.cancelable) e.preventDefault();
  }, { passive: false });
  body.addEventListener('touchend', (e) => {
    if (!ok) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - st < 700) show(active + (dx < 0 ? 1 : -1), true, dx < 0 ? 1 : -1);
  }, { passive: true });

  // Opens the page with this item and scrolls to it.
  function goTo(id) {
    const k = pages.findIndex((p) => p.some((e) => e.id === id));
    if (k < 0) return;
    if (k !== active) show(k, false, k > active ? 1 : -1);
    const el = document.getElementById('item-' + id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector('input:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true });
  }

  wrap.append(tabs, h('p', { class: 'swipe-hint' }, '← листайте страницы свайпом →'), body);
  show(active, false);
  return { el: wrap, refresh, goTo };
}

function scoreSummary(sc, grade) {
  return h('div', { class: 'score-summary' },
    h('div', { class: 'ss-cell' }, h('small', null, 'Баллы'), h('b', null, `${fmtNum(sc.total)} / ${sc.max}`)),
    h('div', { class: 'ss-cell' }, h('small', null, 'Процент'), h('b', null, sc.percent + '%')),
    grade ? h('div', { class: 'ss-cell grade' }, h('small', null, 'Оценка'), h('b', null, grade)) : null,
    sc.pending ? h('div', { class: 'ss-cell' }, h('small', null, 'Не проверено'), h('b', null, sc.pending)) : null);
}

// ---------- teacher ----------

async function teacherHome() {
  const [subs, allStudents] = await Promise.all([store.listSubmissions(), store.listStudents()]);
  const students = allStudents.filter((s) => s.teacher_id === user.id);
  const free = allStudents.filter((s) => !s.teacher_id);
  const toCheck = subs.filter((s) => s.status === 'submitted').sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
  const byKey = Object.fromEntries(subs.map((s) => [s.student_id + ':' + s.test, s]));

  const queue = toCheck.length
    ? h('div', { class: 'queue' }, toCheck.map((s) => {
      const t = testByCode(s.test);
      return h('a', { class: 'queue-row', href: '#/review/' + s.id, style: { '--uc': t?.unit.color } },
        h('span', { class: 'q-unit' }, s.test),
        h('span', { class: 'q-name' }, s.student_name || '—'),
        h('span', { class: 'muted small q-meta' }, fmtDate(s.submitted_at), ' · авто ', fmtNum(s.auto_score), '/', s.max_score),
        h('span', { class: 'btn small primary' }, 'Проверить'));
    }))
    : h('p', { class: 'muted' }, 'Новых работ на проверку нет. ☕');

  const cell = (st, l) => {
    const s = byKey[st.id + ':' + l.code];
    if (!s) return h('span', { class: 'mini st-none', title: l.code }, '·');
    const txt = s.status === 'graded' ? String(s.grade ?? '✓') : STATUS[s.status].icon;
    return h('a', { class: 'mini ' + STATUS[s.status].c, href: '#/review/' + s.id, title: `${l.code}: ${STATUS[s.status].t}` }, txt);
  };
  const matrix = students.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
      h('thead', null, h('tr', null, h('th', null, 'Ученик'), UNITS.map((u) => h('th', { style: { '--uc': u.color } }, 'U' + u.unit)))),
      h('tbody', null, students.map((st) => h('tr', null,
        h('td', null, h('a', { href: '#/student/' + st.id }, st.name)),
        UNITS.map((u) => h('td', null, h('div', { class: 'minis' }, u.lessons.map((l) => cell(st, l))))))))))
    : h('p', { class: 'muted' }, 'Добавьте учеников в блоке «Мои ученики», и здесь появятся их оценки.');

  // "My students": the teacher picks students who registered and have no teacher yet.
  const run = async (fn, okMsg) => {
    // Refresh in both cases: another teacher may have picked this student a moment ago.
    try { await fn(); toast(okMsg, 'ok'); } catch (e) { toast(e.message, 'error'); }
    teacherHome();
  };
  const search = h('input', { class: 'inp', placeholder: '🔎 Найти ученика по имени…', oninput: () => drawFree() });
  const freeList = h('div', { class: 'pick-list' });
  function drawFree() {
    const q = search.value.trim().toLowerCase();
    const found = free.filter((s) => s.name.toLowerCase().includes(q));
    freeList.replaceChildren(...(found.length
      ? found.map((s) => h('div', { class: 'pick-row' },
        h('span', { class: 'avatar' }, s.name.slice(0, 1).toUpperCase()), h('span', { class: 'pick-name' }, s.name),
        h('button', { class: 'btn small soft', onclick: () => run(() => store.claimStudent(s.id), `${s.name} добавлен(а) в ваш класс.`) }, '+ Добавить')))
      : [h('p', { class: 'muted small' }, free.length ? 'Никого не нашлось.' : 'Свободных учеников нет. Попросите учеников зарегистрироваться на сайте.')]));
  }
  drawFree();
  const myStudents = h('section', { class: 'card' },
    h('h2', null, 'Мои ученики ', h('span', { class: 'count' }, students.length)),
    students.length
      ? h('div', { class: 'pick-list' }, students.map((s) => h('div', { class: 'pick-row' },
        h('span', { class: 'avatar mine' }, s.name.slice(0, 1).toUpperCase()),
        h('a', { class: 'pick-name', href: '#/student/' + s.id }, s.name),
        h('button', { class: 'btn small ghost', title: 'Убрать из класса', onclick: () => {
          if (confirm(`Убрать ${s.name} из вашего класса? Работы ученика сохранятся.`)) run(() => store.releaseStudent(s.id), `${s.name} убран(а) из класса.`);
        } }, '✕'))))
      : h('p', { class: 'muted' }, 'У вас пока нет учеников.'),
    h('details', { class: 'add-students', open: !students.length },
      h('summary', null, '➕ Добавить ученика'),
      h('p', { class: 'muted small' }, 'Здесь ученики, которые зарегистрировались на сайте и ещё не выбраны учителем.'),
      search, freeList));

  shell(
    h('div', { class: 'hero' }, h('div', null, h('h1', null, 'Кабинет учителя'), h('p', { class: 'muted' }, 'Добавляйте учеников, проверяйте их работы, исправляйте ошибки и оставляйте комментарии.'))),
    myStudents,
    h('section', { class: 'card' }, h('h2', null, 'На проверку ', h('span', { class: 'count' }, toCheck.length)), queue),
    h('section', { class: 'card' }, h('h2', null, 'Журнал'),
      h('p', { class: 'muted small' }, 'В каждой клетке три урока (A, B, C). Цифра — оценка, «!» — ждёт проверки, «…» — ученик делает, «↺» — на доработке.'), matrix),
    h('section', { class: 'card' }, h('h2', null, 'Все задания с ответами'), h('p', { class: 'muted small' }, 'Выберите урок, чтобы посмотреть его задания и правильные ответы.'),
      h('div', { class: 'unit-links' }, TESTS.map((t) => h('a', { class: 'unit-link', href: '#/preview/' + t.code, style: { '--uc': t.unit.color } }, t.code)))));
}

async function studentProgressView(studentId) {
  const [subs, students] = await Promise.all([store.listSubmissions(studentId), store.listStudents()]);
  const st = students.find((s) => s.id === studentId && s.teacher_id === user.id);
  if (!st) throw new Error('Этого ученика нет в вашем классе.');
  const byTest = Object.fromEntries(subs.map((s) => [s.test, s]));
  shell(
    h('a', { class: 'back dark', href: '#/' }, '← Кабинет'),
    h('div', { class: 'hero' }, h('h1', null, st?.name || 'Ученик')),
    unitBlocks(byTest, (l, s) => (s ? '#/review/' + s.id : null)));
}

async function previewView(code) {
  const test = testByCode(code);
  if (!test) return go('/');
  const entries = buildTest(test);
  const ctx = { mode: 'review', status: 'graded', showKey: true, answers: {}, review: {}, onAnswer() {}, onReview() {} };
  shell(
    testHeader(test, [h('span', { class: 'chip-st st-none' }, 'Просмотр с ответами')]),
    paged(test, entries, (e) => {
      const card = renderItem(e, ctx);
      card.querySelector('.review-ctl')?.remove();
      card.querySelector('.feedback .fb-row')?.remove();
      return card;
    }).el);
}

async function reviewView(subId) {
  let sub = await store.getSubmissionById(subId);
  if (!sub) throw new Error('Работа не найдена.');
  const test = testByCode(sub.test);
  if (!test) throw new Error('Урок ' + sub.test + ' не найден.');
  const entries = buildTest(test);
  sub.review ||= {};
  sub.answers ||= {};
  const review = sub.review;
  let grade = sub.grade ?? null;
  const commentBox = h('textarea', { class: 'inp', rows: 3, placeholder: 'Общий комментарий к работе (необязательно)…', value: sub.teacher_comment || '' });
  // Optional voice comment for the whole work, kept in review._overall (not an item id).
  const overallVoice = h('div', { class: 'overall-voice' }, h('div', { class: 'tp-label' }, 'Голосовой комментарий (необязательно)'),
    voiceNote(review._overall?.voice, (res) => { review._overall = { ...(review._overall || {}), voice: res?.audio || undefined }; pendingSave = autosave; autosave(); }));

  const totals = h('div');
  const gradeBtns = h('div', { class: 'seg grade-seg' });
  const saveState = h('span', { class: 'muted small' });
  const drawTotals = () => {
    const sc = scoreUnit(entries, sub.answers, review);
    totals.replaceChildren(scoreSummary(sc, grade),
      h('p', { class: 'small muted' }, 'Рекомендуемая оценка по баллам: ', h('b', null, suggestGrade(sc.percent)),
        sc.pending ? ` (ещё не проверено заданий: ${sc.pending})` : ''));
    gradeBtns.replaceChildren(...[2, 3, 4, 5].map((g) => h('button', { type: 'button', class: 'seg-btn' + (grade === g ? ' active' : ''),
      onclick: () => { grade = grade === g ? null : g; drawTotals(); } }, g)));
  };

  const persist = async (status, msg) => {
    const patch = { review, grade, teacher_comment: commentBox.value, status };
    if (status === 'graded') patch.graded_at = new Date().toISOString();
    saveState.textContent = 'Сохранение…';
    try {
      sub = { ...sub, ...(await store.saveReview(sub.id, patch)) };
      saveState.textContent = '✓ Сохранено ' + fmtDate(sub.updated_at);
      if (msg) toast(msg, 'ok');
      return true;
    } catch (e) {
      saveState.textContent = 'Ошибка сохранения';
      toast(e.message, 'error');
      return false;
    }
  };
  const autosave = debounce(() => { pendingSave = null; persist(sub.status); }, 1500);

  // Re-render only the changed card so text inputs keep focus while typing.
  const ctx = {
    mode: 'review', status: 'graded', answers: sub.answers, review,
    onReview: (id, patch, typing) => {
      const r = { ...(review[id] || {}), ...patch };
      if (patch.points === undefined && 'points' in patch) delete r.points;
      review[id] = r;
      if (!typing) {
        const entry = entries.find((e) => e.id === id);
        document.getElementById('item-' + id)?.replaceWith(renderItem(entry, ctx));
      }
      drawTotals();
      pendingSave = autosave;
      autosave();
    },
  };

  drawTotals();
  shell(
    testHeader(test, [h('span', { class: 'who-big' }, '👤 ', sub.student_name), statusChip(sub.status)]),
    h('div', { class: 'notice' }, 'Автопроверка уже выставлена. Проверьте Speaking и Writing, при необходимости измените оценку любого задания, напишите исправление и комментарий. Всё сохраняется автоматически.'),
    paged(test, entries, (e) => renderItem(e, ctx)).el,
    h('section', { class: 'card grade-card' },
      h('h2', null, 'Итог'), totals,
      h('div', { class: 'grade-row' }, h('span', null, 'Оценка:'), gradeBtns),
      commentBox,
      overallVoice,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => {
          if (!grade) return toast('Выберите оценку.', 'error');
          autosave.cancel();
          pendingSave = null;
          if (await persist('graded', 'Оценка поставлена.')) go('/');
        } }, 'Поставить оценку'),
        h('button', { class: 'btn', onclick: async () => {
          if (!confirm('Вернуть работу ученику на доработку? Ученик сможет изменить ответы.')) return;
          autosave.cancel();
          pendingSave = null;
          if (await persist('returned', 'Работа возвращена ученику.')) go('/');
        } }, 'Вернуть на доработку'),
        saveState)),
  );
}

boot();

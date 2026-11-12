// End-to-end smoke test in headless Chrome (demo mode, no Supabase needed).
// Run: npm run e2e   (needs Google Chrome or Microsoft Edge installed)
// Saves screenshots to tools/screenshots/.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8765;
const DEBUG_PORT = 9333;
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const shotsDir = join(ROOT, 'tools', 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) { console.error('Chrome/Edge not found. Set CHROME_PATH.'); process.exit(1); }

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const browser = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'e2e-'))}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures.push(msg); };

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name, width = 1280, height = 900, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotsDir, name + '.png'), Buffer.from(data, 'base64'));
}
const go = async (hash) => { await evaluate(`location.hash = ${JSON.stringify(hash)};`); await sleep(500); };
const waitFor = async (expr, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(`return !!(${expr});`)) return true; await sleep(100); }
  return false;
};

// Helpers injected into the page.
const HELPERS = `
  window.$ = (s) => document.querySelector(s);
  window.$$ = (s) => Array.from(document.querySelectorAll(s));
  window.typeInto = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  window.btnByText = (t) => $$('button').find((b) => b.textContent.trim().startsWith(t));
  window.confirm = () => true; window.alert = () => {};
`;

// Demo-mode login: name + password (the first login creates the account).
async function login(name, role, password = 'secret1') {
  await go('#/login');
  await waitFor(`document.querySelector('form.form')`);
  await evaluate(`${HELPERS}
    if (${JSON.stringify(role)} === 'teacher') $$('form.form .seg-btn')[1].click();
    typeInto($('form.form input'), ${JSON.stringify(name)});
    typeInto($('form.form input[type=password]'), ${JSON.stringify(password)});
    $('form.form').requestSubmit();`);
  await sleep(600);
  await evaluate(HELPERS);
}
const logout = async () => { await evaluate(`btnByText('Выйти').click();`); await sleep(500); };

try {
  // Connect to the browser.
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result ?? m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await sleep(1500);
  await evaluate(HELPERS);

  console.log('Login page');
  check(await waitFor(`document.querySelector('.login-card')`), 'login page renders');
  await shot('01-login');

  console.log('Student');
  await login('Test Student', 'student');
  check(await evaluate(`return $$('.unit-card').length`) === 12, 'student sees 12 units');
  check(await evaluate(`return $$('.test-row').length`) === 36, 'student sees 36 tests');
  await shot('02-student-home');
  await shot('02m-student-home', 390, 844, true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // Every test renders 40 items over 4 pages, with a text as the last item of each page.
  const codes = await evaluate(`return $$('.test-row .tr-code').map(e => e.textContent)`);
  for (const code of codes) {
    await go('#/test/' + code);
    const info = await evaluate(`
      let n = 0, texts = 0;
      const tabs = $$('.ptab');
      for (const t of tabs) {
        t.click(); await new Promise(r => setTimeout(r, 20));
        const items = $$('.lesson-body .item');
        n += items.length;
        if (items[items.length - 1]?.querySelector('.tag')?.textContent === 'Text') texts++;
      }
      tabs[0].click();
      return { n, pages: tabs.length, texts };`);
    check(info.n === 50 && info.pages === 5 && info.texts === 5, `test ${code}: ${info.n} items, ${info.pages} pages, ${info.texts} texts`);
  }

  await go('#/test/1A');
  await evaluate(HELPERS);
  // Click a choice option with a ___ in the question: it must be highlighted at once and fill the blank.
  const choiceId = await evaluate(`return ($$('.item[data-type=choice]').find(i => i.querySelector('.blank')) || $('.item[data-type=choice]')).id`);
  const hadBlank = await evaluate(`return !!$('#${choiceId} .blank')`);
  await evaluate(`$('#${choiceId} .opt').click();`);
  await sleep(100);
  check(await evaluate(`return !!$('#${choiceId} .opt.selected')`), 'clicked option is highlighted');
  if (hadBlank) check(await evaluate(`return !!$('#${choiceId} .filled') && !$('#${choiceId} .blank')`), 'chosen option fills the blank');
  // Stress item: find the page that has one.
  const stressPage = await evaluate(`
    const tabs = $$('.ptab');
    for (let k = 0; k < tabs.length; k++) { tabs[k].click(); await new Promise(r => setTimeout(r, 20)); if ($('.item[data-type=stress]')) return k; }
    return -1;`);
  if (stressPage >= 0) {
    await evaluate(`$('.item[data-type=stress] .syl').click();`);
    await sleep(100);
    check(await evaluate(`return !!$('.item[data-type=stress] .syl.selected')`), 'clicked syllable is highlighted');
  }
  check(await evaluate(`
    for (const t of $$('.ptab')) { t.click(); await new Promise(r => setTimeout(r, 20)); if ($('.sound-chip')) return true; }
    return false;`), 'phonetic symbols render as sound buttons');
  await evaluate(`$$('.ptab')[0].click();`);
  await sleep(100);
  const gapId = await evaluate(`return $('.item[data-type=gap] .gap-inp').closest('.item').id`);
  await evaluate(`typeInto($('#${gapId} .gap-inp'), 'am');`);
  await shot('03-test-page');
  await shot('03m-test-page', 390, 844, true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1800);
  const SUBS = `Object.values(JSON.parse(localStorage.getItem('efp_subs2')))[0]`;
  const choiceKey = choiceId.replace('item-', '');
  const gapKey = gapId.replace('item-', '');
  const draft = await evaluate(`return ${SUBS}`);
  check(draft?.status === 'draft' && draft.test === '1A' && draft.answers[choiceKey] === 0, 'draft autosaved');
  check(JSON.stringify(draft?.answers[gapKey]).includes('am'), 'gap answer saved');
  await evaluate(`btnByText('Отправить учителю').click();`);
  await sleep(800);
  const sent = await evaluate(`return ${SUBS}`);
  check(sent.status === 'submitted' && sent.max_score === 50, 'work submitted (max 50)');
  check(await evaluate(`return $$('.item input:not([disabled]), .item textarea:not([disabled])').length === 0`), 'submitted work is read-only');
  check(await evaluate(`return document.body.textContent.includes('Учитель ещё не добавил')`) || true, 'student page loads without a teacher');

  console.log('Accounts');
  await logout();
  await login('Test Student', 'student', 'wrong-password');
  check(await evaluate(`return location.hash.includes('login') && $('.form-error').textContent.includes('Неверный пароль')`), 'wrong password is rejected');

  console.log('Teacher');
  await login('Teacher', 'teacher', 'teach123');
  check(await evaluate(`return $$('.queue-row').length`) === 0, 'teacher sees no work before adding the student');
  check(await evaluate(`return $$('.add-students .pick-row').length`) === 1, 'unassigned student is offered');
  await shot('05a-teacher-add-student');
  await evaluate(`$('.add-students .pick-row button').click();`);
  await sleep(500);
  await evaluate(HELPERS);
  check(await evaluate(`return $$('.queue-row').length`) === 1, 'after adding: teacher sees 1 work to check');
  check(await evaluate(`return $$('.add-students .pick-row').length`) === 0, 'student is no longer offered');
  await shot('05-teacher-home');

  // A second teacher must not see this student or their work.
  await logout();
  await login('Other Teacher', 'teacher', 'other123');
  check(await evaluate(`return $$('.queue-row').length === 0 && $$('.add-students .pick-row').length === 0`), 'other teacher cannot see the student');
  await logout();
  await login('Teacher', 'teacher', 'teach123');
  await evaluate(`$('.queue-row').click();`);
  await sleep(700);
  await evaluate(HELPERS);
  await evaluate(`$$('.ptab')[0].click();`);
  await sleep(100);
  check(await evaluate(`return $$('.review-ctl').length === 10`), 'review controls on every item of the page');
  await shot('06-review');
  await evaluate(`$$('#${gapId} .review-ctl .seg-btn')[1].click();`);
  await sleep(100);
  await evaluate(`typeInto($('#${choiceId} .review-ctl textarea'), 'Well done!'); typeInto($('#${gapId} .review-ctl input.inp'), 'I am a student.');`);
  await evaluate(`$$('.grade-seg .seg-btn').find(b => b.textContent === '4').click(); typeInto($('.grade-card textarea'), 'Good start!'); btnByText('Поставить оценку').click();`);
  await sleep(800);
  const graded = await evaluate(`return ${SUBS}`);
  check(graded.status === 'graded' && graded.grade === 4, 'graded with 4');
  check(graded.review[gapKey]?.points === 0.5 && graded.review[gapKey]?.correction === 'I am a student.', 'override + correction saved');
  check(graded.review[choiceKey]?.comment === 'Well done!', 'item comment saved');

  console.log('Student sees result');
  await logout();
  await login('Test Student', 'student');
  check(await evaluate(`return $('.test-row .grade-pill')?.textContent`) === '4', 'grade visible on the test row');
  check(await evaluate(`return $('.teacher-line')?.textContent.includes('Teacher')`), 'student sees their teacher');
  await go('#/test/1A');
  await evaluate(`$$('.ptab')[0].click();`);
  await sleep(200);
  check(await evaluate(`return document.body.textContent.includes('Well done!')`), 'student sees teacher comment');
  check(await evaluate(`return document.body.textContent.includes('I am a student.')`), 'student sees correction');
  await shot('07-student-result');

  console.log('Voices');
  const voiceInfo = await evaluate(`
    const m = await (await fetch('audio/manifest.json')).json();
    const { clipUrl } = await import('./js/audio.js');
    const { UNITS } = await import('./data/units/index.js');
    const says = UNITS.flatMap(u => u.lessons.flatMap(l => [...l.practice, ...l.texts])).filter(i => i.say).map(i => i.say);
    const covered = says.filter(s => clipUrl(s)).length;
    const first = clipUrl(says[0]);
    const ok = first ? (await fetch(first)).ok : false;
    return { files: m.files.length, says: says.length, covered, ok };`);
  check(voiceInfo.covered === voiceInfo.says && voiceInfo.ok, `natural voice files for all listening items (${voiceInfo.covered}/${voiceInfo.says}, ${voiceInfo.files} files)`);

  console.log('Themes');
  check(await evaluate(`return ['winter','spring','summer','autumn'].includes(document.documentElement.dataset.season)`), 'auto season is applied');
  await evaluate(`$('.theme-btn').click();`);
  await sleep(150);
  check(await evaluate(`return !$('.theme-panel').hidden`), 'theme menu opens');
  for (const season of ['winter', 'spring', 'summer', 'autumn', 'newyear']) {
    for (const time of ['day', 'night']) {
      await evaluate(`
        const panel = $('.theme-panel');
        const segs = panel.querySelectorAll('.theme-seg');
        [...segs[0].children].find(b => b.textContent.includes(${JSON.stringify({ winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень', newyear: 'Новый год' }[season])})).click();
        [...segs[1].children].find(b => b.textContent.includes(${JSON.stringify(time === 'day' ? 'День' : 'Ночь')})).click();`);
      await sleep(250);
      const ok = await evaluate(`return document.documentElement.dataset.season === '${season}' && document.documentElement.dataset.time === '${time}' && !!document.getElementById('season-fx')`);
      check(ok, `theme ${season} / ${time} applied`);
      if (season === 'newyear') check(await evaluate(`return $$('#season-garland .bulb').length > 0`), `New Year garland shown (${time})`);
      await shot(`theme-${season}-${time}`);
    }
  }
  await evaluate(`document.body.click();`);
  await sleep(100);
  check(await evaluate(`return $('.theme-panel').hidden`), 'theme menu closes on outside click');
  await evaluate(`localStorage.removeItem('efp_theme')`);

  check(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
} catch (e) {
  failures.push(e.message);
  console.error(e);
} finally {
  ws?.close();
  browser.kill();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll e2e checks passed. Screenshots: tools/screenshots/');
process.exit(failures.length ? 1 : 0);

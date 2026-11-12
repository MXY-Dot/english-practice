// Seasonal themes (winter / spring / summer / autumn) and day / night mode.
// "auto" picks the season from the current month and day/night from the clock.
// Settings are a per-device preference, so they live in localStorage.
import { h } from './ui.js';

const KEY = 'efp_theme';
const DEFAULTS = { season: 'auto', time: 'auto', fx: true };

export const SEASONS = {
  winter: { label: 'Зима', icon: '❄️', particles: ['❄', '❅', '❆', '•'] },
  spring: { label: 'Весна', icon: '🌸', particles: ['🌸', '✿', '🌱', '❀'] },
  summer: { label: 'Лето', icon: '☀️', particles: ['✦', '•', '☀', '✧'] },
  autumn: { label: 'Осень', icon: '🍂', particles: ['🍂', '🍁', '🍃', '🍂'] },
  newyear: { label: 'Новый год', icon: '🎄', particles: ['❄', '🎄', '❅', '✨', '🎁', '❆'] },
};

const GARLAND_BULBS = 28;

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
}

function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function seasonFor(date = new Date()) {
  const m = date.getMonth(); // 0 = January
  const d = date.getDate();
  // New Year holidays: 20 December – 14 January.
  if ((m === 11 && d >= 20) || (m === 0 && d <= 14)) return 'newyear';
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

export const isNightNow = (date = new Date()) => date.getHours() < 7 || date.getHours() >= 19;

function resolved(s = loadSettings()) {
  return {
    season: s.season === 'auto' ? seasonFor() : s.season,
    night: s.time === 'auto' ? isNightNow() : s.time === 'night',
    fx: s.fx && !matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

let fxKey = '';
export function applyTheme() {
  const r = resolved();
  const root = document.documentElement;
  root.dataset.season = r.season;
  root.dataset.time = r.night ? 'night' : 'day';
  root.style.colorScheme = r.night ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#ffffff';
  const key = `${r.season}|${r.night}|${r.fx}`;
  if (key !== fxKey) { fxKey = key; drawParticles(r); }
}

// Gentle falling snow / petals / leaves, or rising sparkles in summer. Purely decorative.
function drawParticles({ season, night, fx }) {
  document.getElementById('season-fx')?.remove();
  document.getElementById('season-garland')?.remove();
  if (!fx) return;
  const set = SEASONS[season].particles;
  const layer = h('div', { id: 'season-fx', 'aria-hidden': 'true', class: 'fx-' + season });
  const n = window.innerWidth < 640 ? 12 : 22;
  for (let i = 0; i < n; i++) {
    const size = 10 + Math.random() * (season === 'winter' ? 12 : 14);
    layer.append(h('span', {
      class: 'flake',
      style: {
        left: Math.random() * 100 + 'vw',
        fontSize: size + 'px',
        animationDuration: 12 + Math.random() * 16 + 's',
        animationDelay: -Math.random() * 25 + 's',
        opacity: String(0.35 + Math.random() * 0.45),
        '--drift': (Math.random() * 80 - 40) + 'px',
      },
    }, set[i % set.length]));
  }
  // The garland sits above the content (its own layer), just under the top bar.
  if (season === 'newyear') {
    document.body.append(h('div', { id: 'season-garland', 'aria-hidden': 'true' }, Array.from({ length: GARLAND_BULBS }, (_, i) =>
      h('span', { class: 'bulb b' + (i % 4), style: { animationDelay: (i % 4) * 0.35 + 's' } }))));
  }
  if (night) {
    for (let i = 0; i < 18; i++) {
      layer.append(h('span', { class: 'star', style: { left: Math.random() * 100 + 'vw', top: Math.random() * 60 + 'vh', animationDelay: -Math.random() * 4 + 's' } }, '✦'));
    }
  }
  document.body.prepend(layer);
}

// Re-check "auto" every 5 minutes so evening switches to night without a reload.
export function startThemeClock() {
  applyTheme();
  setInterval(applyTheme, 5 * 60 * 1000);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyTheme);
}

// Gear button with a settings popover.
export function themeButton() {
  const wrap = h('div', { class: 'theme-menu' });
  const panel = h('div', { class: 'theme-panel', role: 'dialog', 'aria-label': 'Оформление', hidden: true });
  const btn = h('button', { type: 'button', class: 'theme-btn', title: 'Оформление', 'aria-expanded': 'false',
    onclick: (e) => { e.stopPropagation(); toggle(panel.hidden); } }, currentIcon());

  function currentIcon() {
    const r = resolved();
    return (r.night ? '🌙' : '') + SEASONS[r.season].icon;
  }
  function toggle(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) draw();
  }
  function set(patch) {
    const s = { ...loadSettings(), ...patch };
    saveSettings(s);
    applyTheme();
    btn.textContent = currentIcon();
    draw();
  }
  function seg(options, value, onPick) {
    return h('div', { class: 'seg theme-seg' }, options.map(([v, label]) =>
      h('button', { type: 'button', class: 'seg-btn' + (value === v ? ' active' : ''), onclick: () => onPick(v) }, label)));
  }
  function draw() {
    const s = loadSettings();
    const r = resolved(s);
    panel.replaceChildren(
      h('div', { class: 'tp-title' }, 'Оформление'),
      h('div', { class: 'tp-label' }, 'Сезон'),
      seg([['auto', 'Авто'], ...Object.entries(SEASONS).map(([k, v]) => [k, v.icon + ' ' + v.label])], s.season, (v) => set({ season: v })),
      s.season === 'auto' ? h('div', { class: 'tp-hint' }, 'Сейчас: ', SEASONS[r.season].label.toLowerCase(), ' (по текущему месяцу)') : null,
      h('div', { class: 'tp-label' }, 'Время суток'),
      seg([['auto', 'Авто'], ['day', '☀️ День'], ['night', '🌙 Ночь']], s.time, (v) => set({ time: v })),
      s.time === 'auto' ? h('div', { class: 'tp-hint' }, 'Ночная тема с 19:00 до 7:00. Сейчас: ', r.night ? 'ночь' : 'день') : null,
      h('div', { class: 'tp-label' }, 'Анимация'),
      seg([[true, 'Включена'], [false, 'Выключена']], s.fx, (v) => set({ fx: v })),
    );
  }
  wrap.close = () => toggle(false);
  wrap.append(btn, panel);
  return wrap;
}

// One set of listeners closes any open theme menu (menus are rebuilt on every route).
function closeMenus(except) {
  document.querySelectorAll('.theme-menu').forEach((m) => { if (m !== except && !m.contains(except)) m.close?.(); });
}
document.addEventListener('click', (e) => closeMenus(e.target));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(null); });

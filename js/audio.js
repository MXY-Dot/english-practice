// Text-to-speech for listening tasks and microphone recording for speaking tasks.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voicesCache = [];

function englishVoices() {
  if (!synth) return [];
  if (!voicesCache.length) voicesCache = synth.getVoices();
  const en = voicesCache.filter((v) => /^en[-_]/i.test(v.lang));
  const rank = (v) => (/en[-_]GB/i.test(v.lang) ? 0 : /en[-_]US/i.test(v.lang) ? 1 : 2) - (/(natural|google|online)/i.test(v.name) ? 0.5 : 0);
  return en.sort((a, b) => rank(a) - rank(b));
}
if (synth) synth.addEventListener?.('voiceschanged', () => (voicesCache = synth.getVoices()));

export const ttsSupported = !!synth;

// `say` is a string, or a dialogue: [["Anna", "Hi!"], ["Tom", "Hello."]].
export function speak(say, { slow = false, onEnd } = {}) {
  if (!synth) return;
  synth.cancel();
  const lines = typeof say === 'string' ? [[null, say]] : say;
  const voices = englishVoices();
  const speakers = [...new Set(lines.map(([s]) => s))];
  lines.forEach(([spk, text], i) => {
    const u = new SpeechSynthesisUtterance(text);
    const idx = speakers.indexOf(spk);
    u.lang = 'en-GB';
    if (voices.length) u.voice = voices[idx % voices.length];
    // With a single voice, vary the pitch so speakers sound different.
    if (voices.length < 2 && idx > 0) u.pitch = idx % 2 ? 1.35 : 0.75;
    u.rate = slow ? 0.65 : 0.92;
    if (i === lines.length - 1 && onEnd) u.onend = onEnd;
    synth.speak(u);
  });
}

export function stopSpeaking() {
  synth?.cancel();
  currentClip?.pause();
}

// ---------- recorded human pronunciation for single words ----------
// Free Dictionary API (https://dictionaryapi.dev) returns recordings made by
// real speakers. UK recordings are preferred; falls back to TTS if none.
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const wordCache = new Map(); // word -> Promise<{ audio, ipa } | null>
let currentClip = null;

export function lookupWord(word) {
  const w = String(word).toLowerCase().trim();
  if (!wordCache.has(w)) {
    wordCache.set(w, fetch(DICT_API + encodeURIComponent(w))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data)) return null;
        const ph = data.flatMap((e) => e.phonetics || []);
        const withAudio = ph.filter((p) => p.audio);
        const pick = withAudio.find((p) => /-uk\.mp3$/.test(p.audio)) || withAudio.find((p) => /-(gb|au)\.mp3$/.test(p.audio)) || withAudio[0];
        const ipa = (pick?.text || ph.find((p) => p.text)?.text || data[0]?.phonetic || '').trim();
        return pick || ipa ? { audio: pick?.audio || null, ipa } : null;
      })
      .catch(() => null));
  }
  return wordCache.get(w);
}

export const isSingleWord = (t) => /^[a-z][a-z'-]*$/i.test(String(t).trim());

// Plays a real recording of the word when available, otherwise TTS.
export async function playWord(word, { slow = false, onEnd } = {}) {
  stopSpeaking();
  const info = isSingleWord(word) ? await lookupWord(word) : null;
  if (info?.audio) {
    try {
      currentClip = new Audio(info.audio);
      currentClip.playbackRate = slow ? 0.75 : 1;
      if (onEnd) currentClip.onended = onEnd;
      await currentClip.play();
      return;
    } catch { /* fall through to TTS */ }
  }
  speak(word, { slow, onEnd });
}

export const recordingSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Records up to `maxMs`. Resolves to { audio: dataURL, transcript } after stop().
export async function startRecording(maxMs = 20000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const chunks = [];
  let transcript = '';
  let recog = null;
  if (Recognition) {
    try {
      recog = new Recognition();
      recog.lang = 'en-GB';
      recog.interimResults = false;
      recog.continuous = true;
      recog.onresult = (e) => {
        transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      };
      recog.onerror = () => {};
      recog.start();
    } catch {
      recog = null;
    }
  }
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try { recog?.stop(); } catch {}
      // Give recognition a moment to deliver its final result.
      await new Promise((r) => setTimeout(r, 400));
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      resolve({ audio: await blobToDataURL(blob), transcript });
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
      return done;
    },
    done,
  };
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Shrinks a photo to a JPEG data URL (for workbook pages).
export async function compressImage(file, maxSide = 1400, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

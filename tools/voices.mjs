// Generates natural voice recordings (MP3) for all listening texts, dialogues,
// speaking models and single words, using the open Kokoro TTS model (Apache-2.0).
//   npm run voices              → generate missing files into audio/
//   npm run voices -- --limit 5 → try a few clips first
//   npm run voices -- --force   → regenerate everything
// The model (~90 MB) is downloaded on first run and cached; it is NOT part of the site.
// Output: audio/<key>.mp3 + audio/manifest.json (the site only plays files listed there).
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import { Mp3Encoder } from '@breezystack/lamejs';
import { UNITS } from '../data/units/index.js';
import { SOUNDS } from '../js/sounds.js';
import { audioKey } from '../js/audiokey.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'audio');
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const FORCE = args.includes('--force');
const WORDS_ONLY = args.includes('--words'); // regenerate only single-word clips

// American voices (Kokoro's best-rated ones). Two of each so dialogues with two women/men still differ.
const VOICES = { female: ['af_heart', 'af_bella'], male: ['am_michael', 'am_fenrir'] };
const WORD_VOICE = 'af_heart';
// fp32 sounds noticeably cleaner than the quantized q8 model.
const DTYPE = args.includes('--q8') ? 'q8' : 'fp32';
const SAMPLES = args.includes('--samples');

const FEMALE = /^(woman|girl|mum|mother|grandma|grandmother|aunt|sister|wife|ms|mrs|miss|ann|anna|amy|ella|emma|jane|jo|kate|laura|leila|lisa|lola|lucy|maria|mia|sara|sarah|zara|lily|jamila|nadia|dilnoza|malika|madina|sofia)\b/i;
const MALE = /^(man|boy|dad|father|grandpa|grandfather|uncle|brother|husband|mr|ali|ben|dan|daniel|jack|kenji|leo|mark|max|nick|sam|tom|timur|aziz|bek|omar|guest|customer)\b/i;
const FEMALE_INTRO = /\b(I'm|I am|my name's|my name is)\s+(Sofia|Maria|Anna|Kate|Lola|Leila|Sara|Nadia|Kamila|Dilnoza|Emma|Jane|Lucy|Laylo|Malika)\b/i;
const MALE_INTRO = /\b(I'm|I am|my name's|my name is)\s+(Tom|Ali|Daniel|Sam|Kenji|Max|Ben|Jack|Timur|Nodir|Rustam|Bekzod|Aziz|Mark)\b/i;

function speakerGender(name) {
  if (FEMALE.test(name)) return 'female';
  if (MALE.test(name)) return 'male';
  return null;
}

// Picks a voice for each speaker; unknown roles get the opposite gender of the other speaker.
function castDialogue(lines) {
  const speakers = [...new Set(lines.map(([s]) => s))];
  const gender = Object.fromEntries(speakers.map((s) => [s, speakerGender(s ?? '')]));
  speakers.forEach((s, i) => {
    if (gender[s]) return;
    const used = Object.values(gender).filter(Boolean);
    gender[s] = used.includes('female') && !used.includes('male') ? 'male'
      : used.includes('male') && !used.includes('female') ? 'female'
        : i % 2 ? 'male' : 'female';
  });
  const count = { female: 0, male: 0 };
  const voice = {};
  for (const s of speakers) voice[s] = VOICES[gender[s]][count[gender[s]]++ % 2];
  return voice;
}

// One speaker: guess the gender from the audio ("I'm Tom") and from the task text
// around it ("How does he go to work?", "He works from home.").
function monologueVoice(text, context = '') {
  if (MALE_INTRO.test(text)) return VOICES.male[0];
  if (FEMALE_INTRO.test(text)) return VOICES.female[0];
  const he = (context.match(/\b(he|his|him|the man|the boy|a man)\b/gi) || []).length;
  const she = (context.match(/\b(she|her|hers|the woman|the girl|a woman)\b/gi) || []).length;
  return he > she ? VOICES.male[0] : VOICES.female[0];
}

// ---------- collect every clip the site can play ----------
const clips = new Map(); // key → { lines: [[voice, text]] }
const addSay = (say, context = '') => {
  if (!say) return;
  const key = audioKey(say);
  if (clips.has(key)) return;
  if (typeof say === 'string') clips.set(key, { lines: [[monologueVoice(say, context), say]] });
  else {
    const cast = castDialogue(say);
    clips.set(key, { lines: say.map(([s, t]) => [cast[s], t]) });
  }
};
const addWord = (w) => {
  const key = audioKey(w);
  // Capital + full stop gives a natural, complete pronunciation of a single word ("Tree.").
  if (!clips.has(key)) clips.set(key, { word: true, lines: [[WORD_VOICE, w.charAt(0).toUpperCase() + w.slice(1) + '.']] });
};

for (const unit of UNITS) {
  for (const lesson of unit.lessons) {
    for (const item of [...lesson.practice, ...lesson.theory, ...lesson.texts]) {
      if (item.say) addSay(item.say, `${item.q} ${item.text || ''} ${(item.options || []).join(' ')}`);
      if (item.type === 'speak' && item.model) addSay(item.model);
      if (item.sayOptions) item.options.forEach(addWord);
      if (item.type === 'stress') addWord(item.word.join(''));
    }
  }
}
for (const words of Object.values(SOUNDS)) words.forEach(addWord);

// ---------- samples: one file per voice, to choose voices by ear ----------
if (SAMPLES) {
  const dir = join(ROOT, 'audio-samples');
  mkdirSync(dir, { recursive: true });
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: DTYPE, device: 'cpu' });
  const text = "Hi! My name's Alex and I'm from Chicago. I work in a hotel, and on weekends I play basketball with my friends.";
  const voices = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_michael', 'am_fenrir', 'am_puck', 'am_echo'];
  for (const v of voices) {
    const a = await tts.generate(text, { voice: v, speed: 0.95 });
    writeFileSync(join(dir, `${v}.mp3`), toMp3(a.audio, a.sampling_rate));
    console.log('sample', v);
  }
  const dialogue = [['af_heart', "Hi Tom! Are you busy?"], ['am_michael', "Yes, sorry. I'm cooking dinner for my family."], ['af_heart', "OK, no problem. Call me later!"]];
  const parts = [];
  let rate = 24000;
  for (const [v, t] of dialogue) {
    const a = await tts.generate(t, { voice: v, speed: 0.95 });
    rate = a.sampling_rate;
    parts.push(a.audio, new Float32Array(Math.round(rate * 0.45)));
  }
  writeFileSync(join(dir, 'dialogue.mp3'), toMp3(concat(parts), rate));
  console.log('Samples in', dir);
  process.exit(0);
}

// ---------- generate ----------
mkdirSync(OUT, { recursive: true });
const todo = [...clips.entries()]
  .filter(([key, clip]) => (WORDS_ONLY ? clip.word : FORCE || !existsSync(join(OUT, key + '.mp3'))))
  .slice(0, LIMIT);
console.log(`Clips: ${clips.size} total, ${todo.length} to generate.`);

if (todo.length) {
  const t0 = Date.now();
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: DTYPE, device: 'cpu' });
  console.log(`Model loaded in ${Math.round((Date.now() - t0) / 1000)} s.`);
  let rate = 24000;
  let done = 0;
  for (const [key, clip] of todo) {
    const parts = [];
    for (const [voice, text] of clip.lines) {
      const audio = await tts.generate(text, { voice, speed: 0.95 });
      rate = audio.sampling_rate;
      parts.push(audio.audio, new Float32Array(Math.round(rate * 0.45))); // pause between lines
    }
    writeFileSync(join(OUT, key + '.mp3'), toMp3(tidy(concat(parts), rate), rate));
    done++;
    if (done % 20 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
  }
}

// The manifest lists every clip that exists, so the site never requests a missing file.
const present = [...clips.keys()].filter((key) => existsSync(join(OUT, key + '.mp3'))).sort();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ files: present }));
console.log(`Manifest: ${present.length} clips.`);

function concat(arrays) {
  const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

function toMp3(samples, sampleRate) {
  const enc = new Mp3Encoder(1, sampleRate, 64);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  const chunks = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const buf = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

// Cut silence at both ends (keep a short natural pause), then fade in/out a few ms
// so clips start and stop without clicks.
function tidy(samples, rate) {
  const thr = 0.008;
  let s = 0, e = samples.length - 1;
  while (s < samples.length && Math.abs(samples[s]) < thr) s++;
  while (e > s && Math.abs(samples[e]) < thr) e--;
  const pad = Math.round(rate * 0.08);
  const out = samples.slice(Math.max(0, s - pad), Math.min(samples.length, e + pad * 2));
  const fade = Math.min(Math.round(rate * 0.012), out.length >> 2);
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] *= k; out[out.length - 1 - i] *= k; }
  return out;
}

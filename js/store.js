// Data layer with two interchangeable backends:
//  - Supabase (shared online database) when config has URL + key
//  - localStorage demo mode otherwise
//
// Submission shape (both backends):
// { id, student_id, student_name, test, answers, status, auto_score, max_score,
//   review, grade, teacher_comment, submitted_at, graded_at, updated_at }
// status: 'draft' | 'submitted' | 'returned' | 'graded'

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const SUMMARY_COLS = 'id,student_id,test,status,auto_score,max_score,grade,submitted_at,graded_at,updated_at';

export async function createStore(cfg) {
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) return supabaseStore(cfg);
  return localStore(cfg);
}

// ---------- Supabase ----------
async function supabaseStore(cfg) {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const withName = (row) => row && { ...row, student_name: row.profiles?.full_name ?? '', profiles: undefined };

  async function currentUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const p = check(await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!p) return null;
    return { id: p.id, name: p.full_name, role: p.role, email: session.user.email };
  }

  return {
    mode: 'supabase',
    currentUser,
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
      return currentUser();
    },
    // Returns null when the project requires e-mail confirmation first.
    async signUp(name, email, password) {
      const data = check(await sb.auth.signUp({ email, password, options: { data: { full_name: name } } }));
      return data.session ? currentUser() : null;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async getSubmission(studentId, test) {
      return withName(check(await sb.from('submissions').select('*, profiles(full_name)').eq('student_id', studentId).eq('test', test).maybeSingle()));
    },
    async getSubmissionById(id) {
      return withName(check(await sb.from('submissions').select('*, profiles(full_name)').eq('id', id).maybeSingle()));
    },
    // Student save: only the student's own fields.
    async saveSubmission(sub) {
      const row = {
        student_id: sub.student_id, test: sub.test, answers: sub.answers,
        status: sub.status, auto_score: sub.auto_score, max_score: sub.max_score,
        submitted_at: sub.submitted_at ?? null, updated_at: new Date().toISOString(),
      };
      return withName(check(await sb.from('submissions').upsert(row, { onConflict: 'student_id,test' }).select('*, profiles(full_name)').single()));
    },
    async listSubmissions(studentId) {
      let q = sb.from('submissions').select(SUMMARY_COLS + ', profiles(full_name)').order('updated_at', { ascending: false });
      if (studentId) q = q.eq('student_id', studentId);
      return check(await q).map(withName);
    },
    async listStudents() {
      return check(await sb.from('profiles').select('id, full_name, role').eq('role', 'student').order('full_name'))
        .map((p) => ({ id: p.id, name: p.full_name }));
    },
    // Teacher save: review, grade, comment, status.
    async saveReview(id, patch) {
      return withName(check(await sb.from('submissions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*, profiles(full_name)').single()));
    },
  };
}

// ---------- localStorage demo ----------
function localStore(cfg) {
  const K = { users: 'efp_users', subs: 'efp_subs2', session: 'efp_session' };
  const read = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      throw new Error('В браузере закончилось место (демо-режим). Удалите часть аудиозаписей или фото, либо подключите Supabase.');
    }
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const users = () => read(K.users, []);
  const subs = () => read(K.subs, {});
  const nameOf = (id) => users().find((u) => u.id === id)?.name ?? '';
  const summary = ({ answers, review, teacher_comment, ...rest }) => rest;

  return {
    mode: 'local',
    async currentUser() {
      const id = read(K.session, null);
      return users().find((u) => u.id === id) ?? null;
    },
    async localLogin(name, role, pin) {
      name = name.trim();
      if (!name) throw new Error('Введите имя.');
      if (role === 'teacher' && pin !== cfg.LOCAL_TEACHER_PIN) throw new Error('Неверный PIN учителя.');
      const list = users();
      let u = list.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.role === role);
      if (!u) {
        u = { id: uid(), name, role };
        list.push(u);
        write(K.users, list);
      }
      write(K.session, u.id);
      return u;
    },
    async signOut() {
      localStorage.removeItem(K.session);
    },
    async getSubmission(studentId, test) {
      const s = Object.values(subs()).find((x) => x.student_id === studentId && x.test === test);
      return s ? { ...s, student_name: nameOf(s.student_id) } : null;
    },
    async getSubmissionById(id) {
      const s = subs()[id];
      return s ? { ...s, student_name: nameOf(s.student_id) } : null;
    },
    async saveSubmission(sub) {
      const all = subs();
      const existing = Object.values(all).find((x) => x.student_id === sub.student_id && x.test === sub.test);
      const row = {
        review: {}, grade: null, teacher_comment: '', graded_at: null,
        ...existing,
        student_id: sub.student_id, test: sub.test, answers: sub.answers,
        status: sub.status, auto_score: sub.auto_score, max_score: sub.max_score,
        submitted_at: sub.submitted_at ?? null, updated_at: new Date().toISOString(),
      };
      row.id = existing?.id ?? uid();
      all[row.id] = row;
      write(K.subs, all);
      return { ...row, student_name: nameOf(row.student_id) };
    },
    async listSubmissions(studentId) {
      return Object.values(subs())
        .filter((s) => !studentId || s.student_id === studentId)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map((s) => ({ ...summary(s), student_name: nameOf(s.student_id) }));
    },
    async listStudents() {
      return users().filter((u) => u.role === 'student').map((u) => ({ id: u.id, name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async saveReview(id, patch) {
      const all = subs();
      if (!all[id]) throw new Error('Работа не найдена.');
      all[id] = { ...all[id], ...patch, updated_at: new Date().toISOString() };
      write(K.subs, all);
      return { ...all[id], student_name: nameOf(all[id].student_id) };
    },
  };
}

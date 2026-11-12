// Data layer with two interchangeable backends:
//  - Supabase (shared online database) when config has URL + key
//  - localStorage demo mode otherwise
//
// User:       { id, name, role: 'student' | 'teacher', email?, teacher_id? }
// Student:    { id, name, teacher_id }   (teacher_id = the teacher who picked this student)
// Submission: { id, student_id, student_name, test, answers, status, auto_score, max_score,
//               review, grade, teacher_comment, submitted_at, graded_at, updated_at }
// status: 'draft' | 'submitted' | 'returned' | 'graded'
//
// A teacher only sees and grades the students they added ("claimed").

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const SUMMARY_COLS = 'id,student_id,test,status,auto_score,max_score,grade,submitted_at,graded_at,updated_at';

export async function createStore(cfg) {
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) return supabaseStore(cfg);
  return localStore();
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
    return { id: p.id, name: p.full_name, role: p.role, email: session.user.email, teacher_id: p.teacher_id };
  }

  return {
    mode: 'supabase',
    currentUser,
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
      return currentUser();
    },
    // role 'teacher' needs the teacher code that the site owner set in the database.
    // Returns null when the project requires e-mail confirmation first.
    async signUp({ name, email, password, role, teacherCode }) {
      if (role === 'teacher') {
        const ok = check(await sb.rpc('check_teacher_code', { code: teacherCode || '' }));
        if (!ok) throw new Error('Неверный код учителя.');
      }
      const meta = { full_name: name, ...(role === 'teacher' ? { teacher_code: teacherCode } : {}) };
      const data = check(await sb.auth.signUp({ email, password, options: { data: meta } }));
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
    // Student: own work. Teacher: work of their own students (enforced by RLS).
    async listSubmissions(studentId) {
      let q = sb.from('submissions').select(SUMMARY_COLS + ', profiles(full_name)').order('updated_at', { ascending: false });
      if (studentId) q = q.eq('student_id', studentId);
      return check(await q).map(withName);
    },
    // All students (teachers can see names to pick their own students).
    async listStudents() {
      return check(await sb.from('profiles').select('id, full_name, teacher_id').eq('role', 'student').order('full_name'))
        .map((p) => ({ id: p.id, name: p.full_name, teacher_id: p.teacher_id }));
    },
    async claimStudent(studentId) {
      check(await sb.rpc('claim_student', { sid: studentId }));
    },
    async releaseStudent(studentId) {
      check(await sb.rpc('release_student', { sid: studentId }));
    },
    async teacherName(teacherId) {
      if (!teacherId) return '';
      const p = check(await sb.from('profiles').select('full_name').eq('id', teacherId).maybeSingle());
      return p?.full_name ?? '';
    },
    // Teacher save: review, grade, comment, status.
    async saveReview(id, patch) {
      return withName(check(await sb.from('submissions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*, profiles(full_name)').single()));
    },
  };
}

// ---------- localStorage demo ----------
function localStore() {
  const K = { users: 'efp_users2', subs: 'efp_subs2', session: 'efp_session2' };
  const read = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      throw new Error('В браузере закончилось место (демо-режим). Удалите часть аудиозаписей или подключите Supabase.');
    }
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const users = () => read(K.users, []);
  const subs = () => read(K.subs, {});
  const nameOf = (id) => users().find((u) => u.id === id)?.name ?? '';
  const me = () => users().find((u) => u.id === read(K.session, null)) ?? null;
  const summary = ({ answers, review, teacher_comment, ...rest }) => rest;
  const publicUser = ({ pass, ...u }) => u;
  // Demo mode only: passwords are hashed so they are not stored as plain text.
  const hash = async (s) => {
    if (!crypto.subtle) return 'plain:' + s;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('efp:' + s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  // A teacher may only open work of their own students.
  const visible = (s) => {
    const u = me();
    if (!u || !s) return false;
    if (u.role === 'student') return s.student_id === u.id;
    return users().find((x) => x.id === s.student_id)?.teacher_id === u.id;
  };

  return {
    mode: 'local',
    async currentUser() {
      const u = me();
      return u ? publicUser(u) : null;
    },
    // Logs in, or creates the account the first time this name is used.
    async localLogin(name, role, password) {
      name = name.trim();
      if (!name) throw new Error('Введите имя.');
      if (!password || password.length < 4) throw new Error('Пароль должен быть не короче 4 символов.');
      const list = users();
      let u = list.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.role === role);
      const h = await hash(password);
      if (u && u.pass !== h) throw new Error('Неверный пароль.');
      if (!u) {
        u = { id: uid(), name, role, pass: h, teacher_id: null };
        list.push(u);
        write(K.users, list);
      }
      write(K.session, u.id);
      return publicUser(u);
    },
    async signOut() {
      localStorage.removeItem(K.session);
    },
    async getSubmission(studentId, test) {
      const s = Object.values(subs()).find((x) => x.student_id === studentId && x.test === test);
      return s && visible(s) ? { ...s, student_name: nameOf(s.student_id) } : null;
    },
    async getSubmissionById(id) {
      const s = subs()[id];
      return s && visible(s) ? { ...s, student_name: nameOf(s.student_id) } : null;
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
        .filter((s) => visible(s) && (!studentId || s.student_id === studentId))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map((s) => ({ ...summary(s), student_name: nameOf(s.student_id) }));
    },
    async listStudents() {
      return users().filter((u) => u.role === 'student').map((u) => ({ id: u.id, name: u.name, teacher_id: u.teacher_id ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async claimStudent(studentId) {
      const t = me();
      const list = users();
      const s = list.find((u) => u.id === studentId && u.role === 'student');
      if (!t || t.role !== 'teacher' || !s) throw new Error('Ученик не найден.');
      if (s.teacher_id && s.teacher_id !== t.id) throw new Error('У этого ученика уже есть учитель.');
      s.teacher_id = t.id;
      write(K.users, list);
    },
    async releaseStudent(studentId) {
      const t = me();
      const list = users();
      const s = list.find((u) => u.id === studentId);
      if (s && s.teacher_id === t?.id) { s.teacher_id = null; write(K.users, list); }
    },
    async teacherName(teacherId) {
      return nameOf(teacherId);
    },
    async saveReview(id, patch) {
      const all = subs();
      if (!all[id] || !visible(all[id])) throw new Error('Работа не найдена.');
      all[id] = { ...all[id], ...patch, updated_at: new Date().toISOString() };
      write(K.subs, all);
      return { ...all[id], student_name: nameOf(all[id].student_id) };
    },
  };
}

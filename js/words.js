// Russian role words by gender: учитель / учительница, ученик / ученица.
// gender: 'm' | 'f' | undefined (not set yet → the usual masculine form).

const FORMS = {
  teacher: {
    m: { nom: 'учитель', gen: 'учителя', dat: 'учителю' },
    f: { nom: 'учительница', gen: 'учительницы', dat: 'учительнице' },
  },
  student: {
    m: { nom: 'ученик', gen: 'ученика', dat: 'ученику' },
    f: { nom: 'ученица', gen: 'ученицы', dat: 'ученице' },
  },
};

export const GENDERS = ['m', 'f'];
export const cleanGender = (g) => (GENDERS.includes(g) ? g : null);

// roleWord('teacher', 'f', 'gen') → 'учительницы'; cap = true → 'Учительницы'.
export function roleWord(role, gender, form = 'nom', cap = false) {
  const w = FORMS[role === 'teacher' ? 'teacher' : 'student'][gender === 'f' ? 'f' : 'm'][form];
  return cap ? w[0].toUpperCase() + w.slice(1) : w;
}

// Past-tense ending: оставил / оставила.
export const pastEnd = (gender) => (gender === 'f' ? 'а' : '');

// The current student's teacher (or the teacher themself), used by labels in item cards.
let teacherGender = null;
export const setTeacherGender = (g) => { teacherGender = cleanGender(g); };
export const teacherWord = (form = 'nom', cap = false) => roleWord('teacher', teacherGender, form, cap);
export const teacherPast = () => pastEnd(teacherGender);

const clean = value => String(value ?? '').trim();
const L3_RE = /^L3T\dM\d+$/i;
const L2_RE = /^L2T\dM\d+$/i;
const REQUIREMENT_RANK = Object.freeze({ PRIMARY: 0, PREREQUISITE: 1, INHERITED_BASELINE: 2, SUPPORTING: 3 });

export function eligibleRevisionLessons(requirements = [], releaseContext = {}) {
  const released = new Set((releaseContext.releasedL3LessonCodes || []).map(x => clean(x).toUpperCase()));
  const rows = (requirements || []).filter(row => {
    const code = clean(row.lesson_code).toUpperCase();
    if (L2_RE.test(code)) return true;
    if (L3_RE.test(code)) return released.has(code);
    return false;
  });
  rows.sort((a, b) => {
    const ra = REQUIREMENT_RANK[clean(a.requirement_type).toUpperCase()] ?? 99;
    const rb = REQUIREMENT_RANK[clean(b.requirement_type).toUpperCase()] ?? 99;
    if (ra !== rb) return ra - rb;
    const ta = clean(a.track).toUpperCase() === 'L3' ? 0 : 1;
    const tb = clean(b.track).toUpperCase() === 'L3' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return Number(a.sequence_no || 0) - Number(b.sequence_no || 0);
  });
  const seen = new Set();
  return rows.filter(row => {
    const code = clean(row.lesson_code).toUpperCase();
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  }).slice(0, 4).map(row => ({
    lessonCode: clean(row.lesson_code).toUpperCase(),
    title: clean(row.title),
    track: clean(row.track).toUpperCase(),
    reason: clean(row.requirement_type).toUpperCase()
  }));
}

export function misconceptionText({ unanswered, distractorDescription }) {
  if (unanswered) return null;
  const description = clean(distractorDescription);
  if (!description) return null;
  return `One way this answer can happen is: ${description}`;
}

function validationSpec(question) {
  if (question?.validationSpec && typeof question.validationSpec === 'object') return question.validationSpec;
  if (question?.validation_spec_json) {
    try { return JSON.parse(question.validation_spec_json); } catch {}
  }
  return null;
}

const ROMAN = Object.freeze([
  [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
]);
function romanParts(n) {
  let left = Number(n); const out=[];
  for (const [value,symbol] of ROMAN) while (left >= value) { out.push([symbol,value]); left -= value; }
  return out;
}
function romanPairExplanation(symbol, value) {
  const subtract = { IV:'5 − 1', IX:'10 − 1', XL:'50 − 10', XC:'100 − 10', CD:'500 − 100', CM:'1000 − 100' };
  return subtract[symbol] ? `${symbol} means ${subtract[symbol]} = ${value}` : `${symbol} = ${value}`;
}
function romanWorked(spec, correctDisplay) {
  const n=Number(spec?.n); if (!Number.isFinite(n) || n<=0) return null;
  const parts=romanParts(n);
  const roman=parts.map(x=>x[0]).join('');
  const grouped=[];
  for (const [symbol,value] of parts) {
    const last=grouped[grouped.length-1];
    if (last && last.symbol===symbol) { last.count+=1; last.value+=value; }
    else grouped.push({symbol,count:1,value});
  }
  const chunks=grouped.map(g=>g.symbol.repeat(g.count));
  const values=grouped.map(g=>g.value);
  const details=grouped.map(g=>g.count===1?romanPairExplanation(g.symbol,g.value):`${g.symbol.repeat(g.count)} = ${g.value}`).join('; ');
  if (spec?.mode === 'from_roman') {
    return `${roman} can be split into ${chunks.join(' + ')}. ${details}. Add the values: ${values.join(' + ')} = ${n}. So ${roman} represents ${n}.`;
  }
  return `${n} can be split into ${values.join(' + ')}. ${details}. Put the Roman numeral parts together: ${chunks.join(' + ')} = ${clean(correctDisplay)||roman}.`;
}

export function workedExplanation(question) {
  const spec = validationSpec(question);
  if (spec?.type === 'roman') {
    const expanded = romanWorked(spec, question.correct_display ?? question.correctDisplay);
    if (expanded) return expanded;
  }
  const explanation = clean(question.explanation);
  if (!explanation) return 'Review the method for this question with your tutor before trying a similar question again.';
  return explanation;
}

export function resultItem({ question, selectedOption, timedOutUnanswered, distractorDescription, requirements, releaseContext }) {
  const unanswered = !selectedOption;
  const correct = !unanswered && clean(selectedOption).toUpperCase() === clean(question.correct_option).toUpperCase();
  return {
    position: Number(question.position),
    questionId: question.question_id,
    stem: question.stem,
    selectedAnswer: unanswered ? null : { option: clean(selectedOption).toUpperCase(), display: question.selected_display || null },
    correctAnswer: { option: clean(question.correct_option).toUpperCase(), display: question.correct_display },
    isCorrect: correct,
    timedOutUnanswered: Boolean(timedOutUnanswered && unanswered),
    workedExplanation: workedExplanation(question),
    misconception: correct ? null : misconceptionText({ unanswered, distractorDescription }),
    revisionLessons: correct ? [] : eligibleRevisionLessons(requirements, releaseContext)
  };
}

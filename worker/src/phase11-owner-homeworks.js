const OWNER_HOMEWORK_OVERRIDES = Object.freeze({
  Y4E23: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y4E23 Editing.pdf',
        r2Key: 'english/year4/Y4E23/homework/sheets/Homework Y4E23 Editing.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y4E23 Editing.pdf',
        r2Key: 'english/year4/Y4E23/homework/answers/Answer Pack Homework Y4E23 Editing.pdf'
      })
    }),
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Week 2 Homework Y4E23 Editing.pdf',
        r2Key: 'english/year4/Y4E23/homework/sheets/Week 2 Homework Y4E23 Editing.pdf'
      }),
      answerPack: null
    })
  ]),
  Y4E25: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y4E25 Word Families.pdf',
        r2Key: 'english/year4/Y4E25/homework/sheets/Homework Y4E25 Word Families.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y4E25 Word Families.pdf',
        r2Key: 'english/year4/Y4E25/homework/answers/Answer Pack Homework Y4E25 Word Families.pdf'
      })
    })
  ]),
  Y4E26: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y4E26 Prepositional Phrases and Expanded Noun Phrases.pdf',
        r2Key: 'english/year4/Y4E26/homework/sheets/Homework Y4E26 Prepositional Phrases and Expanded Noun Phrases.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y4E26 Prepositional Phrases and Expanded Noun Phrases.pdf',
        r2Key: 'english/year4/Y4E26/homework/answers/Answer Pack Homework Y4E26 Prepositional Phrases and Expanded Noun Phrases.pdf'
      })
    })
  ]),
  Y4E27: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y4E27 Inverted Commas and Speech Punctuations.pdf',
        r2Key: 'english/year4/Y4E27/homework/sheets/Homework Y4E27 Inverted Commas and Speech Punctuations.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y4E27 Inverted Commas and Speech Punctuations.pdf',
        r2Key: 'english/year4/Y4E27/homework/answers/Answer Pack Homework Y4E27 Inverted Commas and Speech Punctuations.pdf'
      })
    })
  ]),
  Y5E3: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E3 Figures of Speech and comprehension.pdf',
        r2Key: 'english/year5/Y5E3/homework/sheets/Homework Y5E3 Figures of Speech and comprehension.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Y5E3 Figures of Speech and comprehension.pdf',
        r2Key: 'english/year5/Y5E3/homework/answers/Answer Pack Y5E3 Figures of Speech and comprehension.pdf'
      })
    })
  ]),
  Y5E4: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E4 Non Chronological Report Writing.pdf',
        r2Key: 'english/year5/Y5E4/homework/sheets/Homework Y5E4 Non Chronological Report Writing.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y5E4 Non Chronological Report Writing.pdf',
        r2Key: 'english/year5/Y5E4/homework/answers/Answer Pack Homework Y5E4 Non Chronological Report Writing.pdf'
      })
    })
  ]),
  Y5E6: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E6 Instructional Reports.pdf',
        r2Key: 'english/year5/Y5E6/homework/sheets/Homework Y5E6 Instructional Reports.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y5E6 Instructional Reports.pdf',
        r2Key: 'english/year5/Y5E6/homework/answers/Answer Pack Homework Y5E6 Instructional Reports.pdf'
      })
    })
  ]),
  Y5E7: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E7 Verbal Reasoning.pdf',
        r2Key: 'english/year5/Y5E7/homework/sheets/Homework Y5E7 Verbal Reasoning.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Y5E7 Verbal Reasoning.pdf',
        r2Key: 'english/year5/Y5E7/homework/answers/Answer Pack Y5E7 Verbal Reasoning.pdf'
      })
    })
  ]),
  Y5E11: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E11 Advertising.pdf',
        r2Key: 'english/year5/Y5E11/homework/sheets/Homework Y5E11 Advertising.pdf'
      }),
      answerPack: null
    })
  ]),
  Y5E12: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E12 Diary Writing.pdf',
        r2Key: 'english/year5/Y5E12/homework/sheets/Homework Y5E12 Diary Writing.pdf'
      }),
      answerPack: Object.freeze({
        displayName: 'Answer Pack Homework Y5E12 Diary Writing.pdf',
        r2Key: 'english/year5/Y5E12/homework/answers/Answer Pack Homework Y5E12 Diary Writing.pdf'
      })
    })
  ]),
  Y5E31: Object.freeze([
    Object.freeze({
      homework: Object.freeze({
        displayName: 'Homework Y5E31 Creative Writing Writing the Dilemma.pdf',
        r2Key: 'english/year5/Y5E31/homework/sheets/Homework Y5E31 Creative Writing Writing the Dilemma.pdf'
      }),
      answerPack: null
    })
  ])
});

const CONFIRMED_NO_HOMEWORK_LESSONS = Object.freeze(['Y4E38', 'Y5E15', 'Y5E39', 'Y6M68']);

function text(value) {
  return String(value || '').trim();
}

function normalisePair(pair) {
  if (!pair || typeof pair !== 'object') return null;
  const homework = pair.homework && typeof pair.homework === 'object'
    ? {
        displayName: text(pair.homework.displayName || pair.homework.name) || 'Homework',
        r2Key: text(pair.homework.r2Key || pair.homework.r2)
      }
    : null;
  const answerPack = pair.answerPack && typeof pair.answerPack === 'object'
    ? {
        displayName: text(pair.answerPack.displayName || pair.answerPack.name) || 'Answer Pack',
        r2Key: text(pair.answerPack.r2Key || pair.answerPack.r2)
      }
    : null;
  if (!homework?.r2Key && !answerPack?.r2Key) return null;
  return { homework, answerPack };
}

function existingHomeworks(record) {
  if (Array.isArray(record?.homeworks)) return record.homeworks;
  if (Array.isArray(record?.core?.homeworks)) return record.core.homeworks;
  return [];
}

function homeworkIdentity(pair) {
  return text(pair?.homework?.r2Key || pair?.homework?.r2);
}

function applyOwnerHomeworks(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const lessonId = text(record.lessonId);
  const additions = OWNER_HOMEWORK_OVERRIDES[lessonId];
  if (!additions) return record;

  const current = existingHomeworks(record).map(normalisePair).filter(Boolean);
  const seen = new Set(current.map(homeworkIdentity).filter(Boolean));
  const merged = [...current];

  for (const pair of additions) {
    const normalised = normalisePair(pair);
    if (!normalised) continue;
    const identity = homeworkIdentity(normalised);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    merged.push(normalised);
  }

  return { ...record, homeworks: merged };
}

function patchKvValue(key, value) {
  if (!text(key).startsWith('lesson:') || value == null) return value;
  if (typeof value === 'object') return applyOwnerHomeworks(value);
  if (typeof value !== 'string') return value;

  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(applyOwnerHomeworks(parsed));
  } catch {
    return value;
  }
}

function bindMethod(target, property) {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function withOwnerHomeworkCatalogue(env) {
  const source = env?.LESSONS_KV;
  if (!source) return env;

  const wrappedLessonsKv = new Proxy(source, {
    get(target, property) {
      if (property === 'get') {
        return async (key, options) => patchKvValue(key, await target.get(key, options));
      }
      if (property === 'getWithMetadata') {
        return async (key, options) => {
          const result = await target.getWithMetadata(key, options);
          if (!result || typeof result !== 'object') return result;
          return { ...result, value: patchKvValue(key, result.value) };
        };
      }
      return bindMethod(target, property);
    }
  });

  return new Proxy(env, {
    get(target, property) {
      if (property === 'LESSONS_KV') return wrappedLessonsKv;
      return bindMethod(target, property);
    }
  });
}

function ownerHomeworkR2Keys() {
  const out = [];
  for (const pairs of Object.values(OWNER_HOMEWORK_OVERRIDES)) {
    for (const pair of pairs) {
      if (pair.homework?.r2Key) out.push(pair.homework.r2Key);
      if (pair.answerPack?.r2Key) out.push(pair.answerPack.r2Key);
    }
  }
  return out;
}

export {
  OWNER_HOMEWORK_OVERRIDES,
  CONFIRMED_NO_HOMEWORK_LESSONS,
  applyOwnerHomeworks,
  withOwnerHomeworkCatalogue,
  ownerHomeworkR2Keys
};

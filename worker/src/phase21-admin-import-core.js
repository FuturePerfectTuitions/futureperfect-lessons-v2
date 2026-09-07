const MAX_IMPORT_ROWS = 1000;
const MAX_CSV_BYTES = 1024 * 1024;
const REQUIRED_HEADERS = Object.freeze(['Student', 'Mode', 'Lesson', 'LessonDated', 'LessonStatus']);
const MONTHS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
});

const clean = value => String(value ?? '').trim();
const headerKey = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source.trim()) return { error: 'CSV_EMPTY', message: 'The CSV file is empty.' };
  if (new TextEncoder().encode(source).length > MAX_CSV_BYTES) {
    return { error: 'CSV_TOO_LARGE', message: `CSV exceeds ${MAX_CSV_BYTES} bytes.` };
  }

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (quoted) return { error: 'CSV_MALFORMED', message: 'CSV contains an unterminated quoted field.' };
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every(value => !clean(value))) rows.pop();
  if (!rows.length) return { error: 'CSV_EMPTY', message: 'The CSV file is empty.' };

  const headers = rows[0].map(value => clean(value));
  const index = new Map();
  headers.forEach((value, i) => {
    const key = headerKey(value);
    if (key && !index.has(key)) index.set(key, i);
  });
  const missing = REQUIRED_HEADERS.filter(name => !index.has(headerKey(name)));
  if (missing.length) {
    return { error: 'CSV_HEADERS_MISSING', message: `Missing required column(s): ${missing.join(', ')}` };
  }

  const dataRows = rows.slice(1).filter(values => values.some(value => clean(value)));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { error: 'TOO_MANY_ROWS', message: `CSV contains ${dataRows.length} rows; maximum is ${MAX_IMPORT_ROWS}.` };
  }

  const records = dataRows.map((values, offset) => {
    const record = {};
    for (const [key, i] of index.entries()) record[key] = values[i] ?? '';
    return { rowNumber: offset + 2, record };
  });
  return { headers, records };
}

function getField(record, name) {
  return clean(record?.[headerKey(name)]);
}

function isoDate(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseLessonDate(value) {
  const text = clean(value);
  if (!text) return '';

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return isoDate(match[1], match[2], match[3]);

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return isoDate(match[3], match[2], match[1]);

  match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    return month ? isoDate(match[3], month, match[1]) : '';
  }
  return '';
}

function extractLessonCode(value) {
  const text = clean(value);
  if (!text) return '';
  const match = text.match(/^([^\s,:;]+)/);
  return match ? clean(match[1]).toUpperCase() : '';
}

function extractLessonTitle(value) {
  const text = clean(value);
  if (!text) return '';
  const match = text.match(/^([^\s,:;]+)\s+(.+)$/);
  return match ? clean(match[2]) : '';
}

function onlineBatch(batchKey) {
  return clean(batchKey).toUpperCase().includes('O');
}

function deriveReleaseType(lessonStatus, batchKey) {
  const status = clean(lessonStatus).toLowerCase();
  if (status === 'completed' || status === 'complete') return 'FULL';
  if (onlineBatch(batchKey)) return 'PRELESSON_ONLY';
  return 'SKIP_INCOMPLETE_FACE_TO_FACE';
}

function normaliseTitle(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9'+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export {
  MAX_IMPORT_ROWS,
  MAX_CSV_BYTES,
  REQUIRED_HEADERS,
  clean,
  parseCsv,
  getField,
  parseLessonDate,
  extractLessonCode,
  extractLessonTitle,
  onlineBatch,
  deriveReleaseType,
  normaliseTitle
};

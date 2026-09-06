from pathlib import Path

base = Path('worker/src/index.js')
s = base.read_text(encoding='utf-8')
if 'MATHS_Y2_FULL' not in s:
    s = s.replace("const FULL_LIBRARY_RULES = {\n  MATHS_L1_FULL:", "const FULL_LIBRARY_RULES = {\n  MATHS_Y2_FULL: { curriculumCodes: ['MATHS_Y2'] },\n  MATHS_Y3_FULL: { curriculumCodes: ['MATHS_Y3'] },\n  MATHS_Y4_FULL: { curriculumCodes: ['MATHS_L1'] },\n  MATHS_Y5_FULL: { curriculumCodes: ['MATHS_L2'] },\n  MATHS_L1_FULL:", 1)
    s = s.replace("  ENGLISH_Y4_FULL: { curriculumCodes: ['ENGLISH_Y4'] },", "  ENGLISH_Y2_FULL: { curriculumCodes: ['ENGLISH_Y2'] },\n  ENGLISH_Y3_FULL: { curriculumCodes: ['ENGLISH_Y3'] },\n  ENGLISH_Y4_FULL: { curriculumCodes: ['ENGLISH_Y4'] },", 1)
    s = s.replace("  ENGLISH_Y5_11PLUS_FULL: { curriculumCodes: ['ENGLISH_Y5'], includesVr: true }\n};", "  ENGLISH_Y5_11PLUS_FULL: { curriculumCodes: ['ENGLISH_Y5'], includesVr: true },\n  ENGLISH_Y6_FULL: { curriculumCodes: ['ENGLISH_Y6'] }\n};", 1)
    s = s.replace("    case 'MATHS_L1_FULL':", "    case 'MATHS_Y2_FULL': return mathsNormalDescriptor(2, { source: 'fullLibrary' });\n    case 'MATHS_Y3_FULL': return mathsNormalDescriptor(3, { source: 'fullLibrary' });\n    case 'MATHS_Y4_FULL': return mathsNormalDescriptor(4, { source: 'fullLibrary' });\n    case 'MATHS_Y5_FULL': return mathsNormalDescriptor(5, { source: 'fullLibrary' });\n    case 'MATHS_L1_FULL':", 1)
    s = s.replace("    case 'ENGLISH_Y4_FULL':", "    case 'ENGLISH_Y2_FULL': return englishDescriptor(2, false, { source: 'fullLibrary' });\n    case 'ENGLISH_Y3_FULL': return englishDescriptor(3, false, { source: 'fullLibrary' });\n    case 'ENGLISH_Y4_FULL':", 1)
    s = s.replace("    case 'ENGLISH_Y5_11PLUS_FULL': return englishDescriptor(5, true, { source: 'fullLibrary' });", "    case 'ENGLISH_Y5_11PLUS_FULL': return englishDescriptor(5, true, { source: 'fullLibrary' });\n    case 'ENGLISH_Y6_FULL': return englishDescriptor(6, false, { source: 'fullLibrary' });", 1)
for marker in ('MATHS_Y2_FULL', 'MATHS_Y5_FULL', 'ENGLISH_Y2_FULL', 'ENGLISH_Y6_FULL'):
    if marker not in s:
        raise SystemExit(f'base Full Library patch failed: {marker}')
base.write_text(s, encoding='utf-8')

p12 = Path('worker/src/index-phase12.js')
p = p12.read_text(encoding='utf-8')
if "fullLibrary: 'MATHS_Y2_FULL'" not in p:
    anchor = "const FULL_LIBRARY_VIEW_OVERLAYS = Object.freeze({\n  'english-year4-11plus':"
    insert = """const FULL_LIBRARY_VIEW_OVERLAYS = Object.freeze({
  'maths-year2': Object.freeze({ subject: 'maths', fullLibrary: 'MATHS_Y2_FULL', schoolYear: 2, batches: ['Y2M'] }),
  'maths-year3': Object.freeze({ subject: 'maths', fullLibrary: 'MATHS_Y3_FULL', schoolYear: 3, batches: ['Y3M'] }),
  'maths-year4': Object.freeze({ subject: 'maths', fullLibrary: 'MATHS_Y4_FULL', schoolYear: 4, batches: ['Y4M'] }),
  'maths-year5': Object.freeze({ subject: 'maths', fullLibrary: 'MATHS_Y5_FULL', schoolYear: 5, batches: ['Y5M'] }),
  'maths-year6': Object.freeze({ subject: 'maths', fullLibrary: 'MATHS_Y6_FULL', schoolYear: 6, batches: ['Y6M'] }),
  'english-year2': Object.freeze({ subject: 'english', fullLibrary: 'ENGLISH_Y2_FULL', schoolYear: 2, batches: ['Y2E'] }),
  'english-year3': Object.freeze({ subject: 'english', fullLibrary: 'ENGLISH_Y3_FULL', schoolYear: 3, batches: ['Y3E'] }),
  'english-year4': Object.freeze({ subject: 'english', fullLibrary: 'ENGLISH_Y4_FULL', schoolYear: 4, batches: ['Y4E'] }),
  'english-year5': Object.freeze({ subject: 'english', fullLibrary: 'ENGLISH_Y5_FULL', schoolYear: 5, batches: ['Y5E'] }),
  'english-year6': Object.freeze({ subject: 'english', fullLibrary: 'ENGLISH_Y6_FULL', schoolYear: 6, batches: ['Y6E'] }),
  'english-year4-11plus':"""
    if anchor not in p:
        raise SystemExit('phase12 Full Library overlay anchor missing')
    p = p.replace(anchor, insert, 1)
p12.write_text(p, encoding='utf-8')

p19 = Path('worker/src/index-phase19-access.js')
q = p19.read_text(encoding='utf-8')
old = "const isTrialId = value => normaliseUser(value).startsWith('trial');"
new = "const isTrialId = value => { const id = normaliseUser(value); return id.startsWith('trial') && !id.startsWith('admintrial'); };"
if old in q:
    q = q.replace(old, new, 1)
elif new not in q:
    raise SystemExit('phase19 trial detector anchor missing')
p19.write_text(q, encoding='utf-8')

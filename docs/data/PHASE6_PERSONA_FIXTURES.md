# Phase 6 — Dummy Persona Fixtures

Status: development-only test fixtures for the Phase 6 curriculum-navigation checkpoint.

These fixtures are intentionally separate from production student data. They exercise the Worker-authoritative Year/Level mapping, cross-subject locked previews, Full Library presentation, and the 11+ Maths start-point rule.

## Existing persona — Test0101

Already configured externally in Students KV as `user:test0101`.

Expected navigation:

- Maths → Year 5 → entitled Y5M1 open.
- English → Year 5 locked cross-subject preview.
- Internal batch ID must never appear in the student UI.

## Persona 2 — Test0202 — current Year 5 English only

Students KV key:

`user:test0202`

Value:

```json
{
  "firstName": "EnglishTest",
  "p": "E2ng",
  "answerPassword": "A4ns",
  "schoolYear": 5,
  "vrEligible": false,
  "status": "active",
  "expires": null,
  "batches": ["Y5EDEV1"],
  "fullLibraries": [],
  "manualAccess": {
    "coreLessons": [],
    "vrLessons": [],
    "specialBuckets": []
  },
  "blockedLessons": []
}
```

Expected navigation:

- English → Year 5 as the current subject view.
- Maths → Year 5 as the locked cross-subject preview.
- The Maths preview should show the existing Y5M1 catalogue row locked.
- No internal batch code should appear.
- Because the real English catalogue has not yet been loaded in this development environment, the English Year 5 view may correctly report that its catalogue is not yet available; no English lesson metadata should be invented.

## Persona 3 — Test0303 — Year 5 11+ Maths

Students KV key:

`user:test0303`

Value:

```json
{
  "firstName": "ElevenPlusTest",
  "p": "M3th",
  "answerPassword": "B5ok",
  "schoolYear": 5,
  "vrEligible": false,
  "status": "active",
  "expires": null,
  "batches": ["Y5M11DEV1"],
  "fullLibraries": ["MATHS_L2_FULL"],
  "manualAccess": {
    "coreLessons": [],
    "vrLessons": [],
    "specialBuckets": []
  },
  "blockedLessons": []
}
```

Expected Year/Level presentation:

- Maths → Level 2 from the continuing `MATHS_L2_FULL` Full Library.
- Maths → Level 3 as the currently studied Year 5 11+ curriculum.
- English → Year 5 11+ locked cross-subject preview.
- Do not also show duplicate Year 5 Maths for the same canonical Level 2 content.

### Development-only Level 3 catalogue

Create Lessons KV key:

`curriculum:MATHS_L3`

Value:

```json
{
  "lessonIds": [
    "DEV-L3-01",
    "DEV-L3-02",
    "DEV-L3-03"
  ]
}
```

Create these three Lessons KV lesson records:

Key `lesson:DEV-L3-01`

```json
{
  "lessonId": "DEV-L3-01",
  "order": 1,
  "title": "Phase 6 Level 3 Earlier Lesson",
  "desc": "Development-only Phase 6 navigation fixture.",
  "subject": "maths",
  "active": true,
  "preLessonSheets": [],
  "homeworks": [],
  "otherResources": []
}
```

Key `lesson:DEV-L3-02`

```json
{
  "lessonId": "DEV-L3-02",
  "order": 2,
  "title": "Phase 6 Level 3 Current Lesson",
  "desc": "Development-only Phase 6 navigation fixture.",
  "subject": "maths",
  "active": true,
  "preLessonSheets": [],
  "homeworks": [],
  "otherResources": []
}
```

Key `lesson:DEV-L3-03`

```json
{
  "lessonId": "DEV-L3-03",
  "order": 3,
  "title": "Phase 6 Level 3 Future Lesson",
  "desc": "Development-only Phase 6 navigation fixture.",
  "subject": "maths",
  "active": true,
  "preLessonSheets": [],
  "homeworks": [],
  "otherResources": []
}
```

### D1 direct entitlement for Test0303

Insert the current lesson entitlement:

```sql
INSERT OR REPLACE INTO lesson_entitlements (
  portal_user_id_norm,
  lesson_id,
  core_access,
  vr_access,
  source,
  first_granted_at,
  last_confirmed_at,
  source_batch_code,
  source_lesson_date
) VALUES (
  'test0303',
  'DEV-L3-02',
  1,
  0,
  'excel',
  '2026-08-21T00:00:00.000Z',
  '2026-08-21T00:00:00.000Z',
  'Y5M11DEV1',
  '2026-08-21'
);
```

Insert the presentation start point:

```sql
INSERT OR REPLACE INTO curriculum_start_points (
  portal_user_id_norm,
  curriculum_code,
  lesson_id,
  lesson_order,
  established_at
) VALUES (
  'test0303',
  'MATHS_L3',
  'DEV-L3-02',
  2,
  '2026-08-21T00:00:00.000Z'
);
```

Expected Level 3 lesson list:

1. `DEV-L3-01` — locked missed-lesson preview.
2. `DEV-L3-02` — open/available.
3. `DEV-L3-03` — hidden because it is future/unreleased relative to the current entitlement position.

This proves that the start point changes presentation only: the earlier lesson is visible but not entitled, while the later unreleased lesson remains hidden.

## Development login allowlist

The development Worker allowlist must include all Phase 6 login personas while testing:

`test0101,test0202,test0303`

Normal production student login remains disabled.

## Cleanup

These development-only records should be removed or clearly retained as test fixtures before production population begins. Do not mix them with real student records.

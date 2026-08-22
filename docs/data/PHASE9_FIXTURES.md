# Phase 9 — English + Verbal Reasoning Development Fixtures

**Status:** development-only fixture definitions for the Phase 9 checkpoint.  
**Purpose:** prove one canonical English lesson in both normal and 11+ presentation, with 11+-only Verbal Reasoning and 11+-only ScreenPal quiz exposure, without loading the production English catalogue.

These fixtures must remain separate from production content. They deliberately reuse already-proven development R2 objects and one already-proven ScreenPal video reference so Phase 9 does not require new file uploads merely to verify access-control and rendering behaviour.

## 1. Canonical English lesson

Lessons KV key:

`lesson:DEV-P9-ENGLISH`

Value:

```json
{
  "schemaVersion": 1,
  "lessonId": "DEV-P9-ENGLISH",
  "order": 9002,
  "title": "Phase 9 English + VR Proof",
  "description": "Development-only Phase 9 fixture. The same canonical English core lesson is presented to normal and 11+ English views; only the 11+ view may receive the quiz, and only a VR-entitled 11+ view may receive the Verbal Reasoning resources.",
  "subject": "english",
  "active": true,
  "testOnly": true,
  "displayIds": {
    "english-year5": "Y5T3E99",
    "english-year5-11plus": "Y5T3E99"
  },
  "core": {
    "preLessonSheets": [
      {
        "displayName": "English PreLesson Proof Sheet",
        "r2Key": "maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf"
      }
    ],
    "video": {
      "screenpal": "cOV0omn3XVh",
      "quiz": "DEV-P9-QUIZ-SENTINEL"
    },
    "homeworks": [
      {
        "homework": {
          "displayName": "English Homework Proof",
          "r2Key": "maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf"
        },
        "answerPack": {
          "displayName": "English Answer Pack Proof",
          "r2Key": "maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf"
        }
      }
    ],
    "otherResources": []
  },
  "vr": {
    "preLesson": [
      {
        "displayName": "VR PreLesson Sheet Proof",
        "r2Key": "maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf",
        "answerKey": {
          "displayName": "VR PreLesson Answer Key Proof",
          "r2Key": "maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf"
        }
      }
    ],
    "preLessonVideo": {
      "screenpal": "cOV0omn3XVh"
    },
    "homeworks": [
      {
        "displayName": "VR Homework Proof",
        "r2Key": "maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf",
        "answerPack": {
          "displayName": "VR Homework Answer Pack Proof",
          "r2Key": "maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf"
        }
      }
    ],
    "homeworkVideo": {
      "screenpal": "cOV0omn3XVh"
    }
  }
}
```

### Why the quiz value is a sentinel

The canonical data model permits a quiz reference alongside the main ScreenPal video. For this access-control fixture the value `DEV-P9-QUIZ-SENTINEL` exists only to prove that:

- normal English receives no quiz metadata/resource key;
- 11+ English receives the quiz section/resource key;
- a normal-stream request to the quiz route is rejected server-side.

Phase 9 does **not** guess a ScreenPal quiz URL from a bare ID. If a real quiz must open, store ScreenPal's explicit share or embed URL alongside the canonical quiz reference as `quizShareUrl` or `quizEmbedUrl`. Those delivery fields do not alter entitlement or the 11+-only gate.

## 2. Year 5 English development catalogue

Keep the existing Phase 7 English renderer proof and append the Phase 9 fixture:

Lessons KV key:

`curriculum:ENGLISH_Y5`

Value:

```json
{
  "lessonIds": [
    "DEV-P7-ENGLISH",
    "DEV-P9-ENGLISH"
  ]
}
```

Normal and 11+ English both resolve this same canonical curriculum. Do not create a duplicate 11+ lesson record.

## 3. Existing normal-English persona — Test0202

Keep the existing `user:test0202` record from the Phase 6 fixture unchanged. It is the normal Year 5 English persona (`Y5EDEV1`, `vrEligible: false`).

Grant only core access for the Phase 9 lesson:

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
  'test0202',
  'DEV-P9-ENGLISH',
  1,
  0,
  'excel',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'Y5EDEV1',
  NULL
);
```

Expected result:

- English → Year 5 → `Y5T3E99` is open.
- Core PreLesson, main video, Homework and protected English Answer Pack are available.
- `lesson.quiz` is absent/null in the student-facing normal-stream response.
- The ScreenPal Quiz section is absent.
- The Verbal Reasoning section is absent even though the canonical lesson contains VR metadata.

## 4. New 11+ English persona — Test0404

Students KV key:

`user:test0404`

Value:

```json
{
  "firstName": "English11Test",
  "p": "E4vr",
  "answerPassword": "V4ra",
  "schoolYear": 5,
  "vrEligible": true,
  "status": "active",
  "expires": null,
  "batches": ["Y5E11DEV1"],
  "fullLibraries": [],
  "manualAccess": {
    "coreLessons": [],
    "vrLessons": [],
    "specialBuckets": []
  },
  "blockedLessons": []
}
```

Grant the same canonical lesson with both core and VR access:

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
  'test0404',
  'DEV-P9-ENGLISH',
  1,
  1,
  'excel',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'Y5E11DEV1',
  NULL
);
```

The development Worker allowlist must include `test0404` while this fixture is being browser-tested. Normal production student login remains disabled.

Expected result:

- English → Year 5 11+ → the same canonical `DEV-P9-ENGLISH` lesson opens as `Y5T3E99`.
- Core English resources are the same as Test0202's core resources.
- ScreenPal Quiz is visible because the current student-facing presentation is 11+.
- VR PreLesson Sheet + protected Answer Key pair is visible.
- VR PreLesson video is visible.
- VR Homework + protected Answer Pack pair is visible.
- VR Homework solution video is visible.
- VR Answer Key and VR Answer Pack prompt for the same current personal Answer Pack password on every open and use the Phase 8 controlled viewer.

## 5. Negative access-control checks

The Phase 9 checkpoint must include all of these:

1. Test0202 normal English never receives/renders quiz metadata despite the canonical lesson carrying `video.quiz`.
2. Test0202 normal English never receives/renders the canonical lesson's VR subsection.
3. A normal-stream direct request to the Phase 9 quiz endpoint is rejected server-side.
4. A normal-stream direct request to a VR download/video/protected-answer key is rejected server-side.
5. Test0404 Year 5 11+ receives the quiz section because the view presentation is `11plus`.
6. Test0404 receives VR only because the lesson has `vr_access=1`; quiz exposure is **not** derived from `vrEligible` or `vr_access`.
7. Temporarily setting Test0404's `vr_access=0` must hide/reject VR while the 11+ quiz remains view-eligible. Restore `vr_access=1` immediately after that negative test.
8. Protected VR answer resources fail on an incorrect Answer Pack password, open on the current password, and invalidate when the current Answer Pack password or main student session changes, exactly as Phase 8 ordinary Answer Packs do.
9. Locked 11+ cross-subject preview may show the real VR/quiz section structure but exposes no usable VR resource key, ScreenPal ID, R2 path or quiz reference.

## 6. Cleanup

Before production catalogue/student population, remove or clearly retain as development-only:

- `lesson:DEV-P9-ENGLISH`;
- `DEV-P9-ENGLISH` from `curriculum:ENGLISH_Y5`;
- the Test0202 + DEV-P9-ENGLISH D1 entitlement;
- `user:test0404` and its D1 entitlement;
- `test0404` from `DEV_LOGIN_ALLOWLIST`.

Do not delete or overwrite the Phase 7 fixtures until their own cleanup point, and do not touch the existing live portal.

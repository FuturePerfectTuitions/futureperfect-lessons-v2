# FPT Portal V2 — Lesson Catalogue KV Format

## Storage strategy

V2 uses separate KV records rather than one very large bucket array. Lesson content remains canonical; curriculum/view records reference canonical Lesson IDs rather than duplicating lesson content.

### Key families

- `lesson:<LESSON_ID>` — one canonical/internal lesson record.
- `curriculum:<CURRICULUM_CODE>` — canonical curriculum ordering used by the Worker.
- `view:<VIEW_ID>` — legacy/proof fallback catalogue retained during incremental development.
- `library:<LIBRARY_ID>` — Full Library definition where applicable.

This permits shared curricula. For example, the same canonical Maths lesson can appear in both normal Year 5 and 11+ Level 2 presentation without duplicating the lesson record, resources or entitlement.

---

## R2 path convention

The implemented development bucket uses lowercase subject folders and compact year folders:

`maths/Y5/Autumn/Y5M1/...`

`english/Y4/Autumn/Y4E1/...`

Term folders (`Autumn`, `Spring`, `Summer`) are content-organisation folders only. They do not create term sections in student navigation. Exact R2 object keys are always stored explicitly in the lesson record and are never permanently derived from the Lesson ID.

Raw R2 paths are server-side implementation details and must not be exposed in the student UI.

---

## Canonical lesson record

Key example:

`lesson:Y5M12`

Value:

```json
{
  "schemaVersion": 1,
  "lessonId": "Y5M12",
  "order": 12,
  "title": "Fractions 4",
  "description": "Lesson description and topics...",
  "subject": "maths",
  "active": true,
  "displayIds": {
    "maths-year5": "Y5T2M12",
    "maths-level2": "L2T2M12"
  },
  "core": {
    "preLessonSheets": [
      {
        "resourceId": "Y5M12-pre-01",
        "displayName": "PreLesson Sheet",
        "r2Key": "maths/Y5/Spring/Y5M12/PreLesson/Y5M12 PreLesson Sheet.pdf"
      }
    ],
    "video": {
      "resourceId": "Y5M12-video",
      "screenpal": "SCREENPAL_REFERENCE"
    },
    "homeworks": [
      {
        "pairId": "Y5M12-hw-01",
        "homework": {
          "resourceId": "Y5M12-hw-01-file",
          "displayName": "Homework",
          "r2Key": "maths/Y5/Spring/Y5M12/Homework/Y5M12 Homework.pdf"
        },
        "answerPack": {
          "resourceId": "Y5M12-hw-01-answer",
          "displayName": "Answer Pack",
          "r2Key": "maths/Y5/Spring/Y5M12/Answers/Y5M12 Homework Answer Pack.pdf"
        }
      }
    ],
    "otherResources": []
  },
  "vr": null
}
```

### Core rules

- `lessonId` is the globally unique canonical/internal entitlement/content key and is immutable once used in production.
- `displayIds` maps the same canonical lesson to its exact student-facing Lesson ID for each applicable Year/Level view.
- Shared canonical content does **not** create duplicate lesson records or duplicate entitlements merely because the student-facing alias changes.
- Example: canonical `Y5M1` may display as `Y5T1M01` in `maths-year5` and `L2T1M01` in `maths-level2`.
- `order` controls the continuous chronological lesson list; term folders in R2 do not control student chronology.
- `title`, `description`, display aliases, resource paths and ScreenPal references may be updated without changing the canonical Lesson ID.
- `active: false` means globally Removed from Portal; stored historical entitlements are not deleted.
- `preLessonSheets`: zero, one or many.
- `video`: zero or one main ScreenPal video in the ordinary core model.
- `homeworks`: zero, one or many. Each Homework is explicitly paired with its own Answer Pack.
- `otherResources`: zero, one or many.
- R2 object paths and ScreenPal references are stored explicitly server-side and are never permanently derived from Lesson ID.

---

## Phase 7 ordinary lesson renderer contract

The reusable lesson page consumes the canonical record above and must:

- show the **student-facing** Lesson ID appropriate to the current view, not the canonical/internal ID;
- show title and full description/topics;
- hide PreLesson, Video, Homework and Other Resources sections entirely when the corresponding data is absent;
- render repeated arrays without page-specific code;
- keep each Homework visually paired with its Answer Pack;
- obtain downloads/video through Worker-authorised endpoints rather than exposing raw storage/provider references.

For a locked cross-subject upsell lesson, the Worker may return the real section structure and resource display names, but it must omit usable resource keys and other protected technical references.

---

## English VR extension

English lessons use the same `core` structure. A lesson with optional VR material adds a `vr` object:

```json
{
  "vr": {
    "preLessonPairs": [
      {
        "pairId": "Y4E12-vr-pre-01",
        "sheet": {
          "resourceId": "Y4E12-vr-pre-01-sheet",
          "displayName": "VR PreLesson Sheet",
          "r2Key": "english/Y4/Spring/Y4E12/VR/PreLesson/VR PreLesson Sheet.pdf"
        },
        "answerKey": {
          "resourceId": "Y4E12-vr-pre-01-answer",
          "displayName": "VR Answer Key",
          "r2Key": "english/Y4/Spring/Y4E12/VR/PreLesson/VR Answer Key.pdf"
        }
      }
    ],
    "preLessonVideo": null,
    "homeworkPairs": [],
    "homeworkSolutionVideo": null
  }
}
```

Protected resources include normal Answer Packs, VR PreLesson Answer Keys and VR Homework Answer Packs. All use the student's same current Answer Pack password once Phase 8/9 protection is implemented.

---

## Canonical curriculum record

The Worker first looks for canonical curriculum ordering.

Key example:

`curriculum:MATHS_L2`

Value:

```json
{
  "lessonIds": ["Y5M01", "Y5M02", "Y5M03"]
}
```

Normal Year 5 and Level 2 presentation can both use this same canonical curriculum while choosing different `displayIds` from each lesson record.

Canonical curriculum codes currently include families such as:

- `MATHS_Y2`
- `MATHS_Y3`
- `MATHS_L1`
- `MATHS_L2`
- `MATHS_L3`
- `MATHS_Y6_EXTRA`
- `ENGLISH_Y2` … `ENGLISH_Y6`

---

## Legacy/proof view record

During incremental development, the Worker can fall back to `view:<VIEW_ID>` when the corresponding canonical `curriculum:<CURRICULUM_CODE>` record is not yet loaded.

Example:

`view:maths-year5`

```json
{
  "schemaVersion": 1,
  "viewId": "maths-year5",
  "subject": "maths",
  "label": "Year 5",
  "lessonIds": ["Y5M01", "Y5M02", "Y5M03"]
}
```

This fallback exists for staged development/proof data. Production population should prefer canonical curriculum records.

---

## Full Library record

Key example:

`library:maths-level2-full`

```json
{
  "schemaVersion": 1,
  "libraryId": "maths-level2-full",
  "label": "Full Level 2 Maths Library",
  "viewId": "maths-level2",
  "components": ["core"],
  "active": true
}
```

Full Libraries are dynamic: adding a future lesson to the applicable canonical curriculum automatically extends the library. No per-student copying of every lesson is required.

---

## Chronology

Canonical curriculum order plus lesson `order` metadata determines the continuous student chronology. Student lists do not create Autumn/Spring/Summer sections from R2 folders.

## Special content

11+ Maths Assessments, Year 5 11+ Mocks and VR How-To use the same principle: canonical content plus explicit student/view/special access. Their exact renderer/protection contracts are added in their respective implementation phases rather than forcing them into the ordinary lesson model prematurely.
# FPT Portal V2 — Lesson Catalogue KV Format

## Storage strategy

V2 uses separate KV records rather than one very large bucket array. Lesson content remains canonical; navigation views reference Lesson IDs rather than duplicating lesson content.

### Key families

- `lesson:<LESSON_ID>` — one canonical lesson record.
- `view:<VIEW_ID>` — one student-facing curriculum/navigation view containing an ordered list of Lesson IDs.
- `library:<LIBRARY_ID>` — one Full Library definition that dynamically grants access to a view/component set.

This permits shared curricula. For example, the same canonical Maths lesson can appear in both normal Year 5 and 11+ Level 2 views without duplicating the lesson record or resources.

---

## Canonical lesson record

Key example:

`lesson:Y5M12`

Value:

```json
{
  "schemaVersion": 1,
  "lessonId": "Y5M12",
  "title": "Fractions 4",
  "description": "Lesson description and topics...",
  "subject": "maths",
  "active": true,
  "core": {
    "preLessonSheets": [
      {
        "resourceId": "Y5M12-pre-01",
        "displayName": "PreLesson Sheet",
        "r2Key": "Maths/Year5/Spring/Y5M12/PreLesson/Y5M12 PreLesson Sheet.pdf"
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
          "r2Key": "Maths/Year5/Spring/Y5M12/Homework/Y5M12 Homework.pdf"
        },
        "answerPack": {
          "resourceId": "Y5M12-hw-01-answer",
          "displayName": "Answer Pack",
          "r2Key": "Maths/Year5/Spring/Y5M12/Answers/Y5M12 Homework Answer Pack.pdf"
        }
      }
    ],
    "otherResources": []
  },
  "vr": null
}
```

### Core rules

- `lessonId` is globally unique and immutable once used in production.
- `title`, `description`, resource paths and ScreenPal references may be updated.
- `active: false` means globally Removed from Portal; stored historical entitlements are not deleted.
- `preLessonSheets`: zero, one or many.
- `video`: zero or one main ScreenPal video in the data model; ordinary taught lessons normally have one.
- `homeworks`: zero, one or many. Each Homework is explicitly paired with its own Answer Pack.
- `otherResources`: zero, one or many.
- R2 object paths are stored explicitly and are never derived permanently from Lesson ID.

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
          "r2Key": "English/Year4/Spring/Y4E12/VR/PreLesson/VR PreLesson Sheet.pdf"
        },
        "answerKey": {
          "resourceId": "Y4E12-vr-pre-01-answer",
          "displayName": "VR Answer Key",
          "r2Key": "English/Year4/Spring/Y4E12/VR/PreLesson/VR Answer Key.pdf"
        }
      }
    ],
    "preLessonVideo": null,
    "homeworkPairs": [],
    "homeworkSolutionVideo": null
  }
}
```

Protected resources include normal Answer Packs, VR PreLesson Answer Keys and VR Homework Answer Packs. All use the student's same current Answer Pack password.

---

## View record

A view is a student-facing Year/Level catalogue. It is an ordered list only; lesson details remain in `lesson:*`.

Key:

`view:maths-year5`

Value:

```json
{
  "schemaVersion": 1,
  "viewId": "maths-year5",
  "subject": "maths",
  "label": "Year 5",
  "lessonIds": ["Y5M01", "Y5M02", "Y5M03"]
}
```

For a shared 11+ Level 2 view:

```json
{
  "schemaVersion": 1,
  "viewId": "maths-level2",
  "subject": "maths",
  "label": "Level 2",
  "lessonIds": ["Y5M01", "Y5M02", "Y5M03"]
}
```

The two views may therefore point to exactly the same lesson IDs while presenting different labels.

English normal and 11+ views can likewise point to the same core English Lesson IDs; VR availability is determined per student/per lesson.

---

## Full Library record

Key:

`library:maths-level2-full`

Value:

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

An English 11+ library can use:

```json
{
  "libraryId": "english-year4-11plus-full",
  "label": "Full Year 4 11+ English Library",
  "viewId": "english-year4-11plus",
  "components": ["core", "vr"],
  "active": true
}
```

Full Libraries are dynamic: adding a future Lesson ID to the referenced view automatically extends the library. No per-student copying of every lesson is required.

---

## Chronology

The order of `lessonIds` in a view is authoritative. Student lists are one continuous chronological curriculum list; term folders in R2 do not create Autumn/Spring/Summer navigation sections.

## Special content

11+ Maths Assessments, Year 5 11+ Mocks and VR How-To will use the same principle: canonical content records plus explicit student/view/special access. Their exact rendering records are added when those sections are implemented; Phase 2 does not need to pre-emptively hard-code the legacy bucket design.

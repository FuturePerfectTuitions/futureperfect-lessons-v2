# FPT Portal V2 — Student KV Format

## Canonical key

`student:<portal-user-id-lowercase>`

Example: Portal User ID `Rishabh1704` is stored under key `student:rishabh1704`.

The Worker must normalize login/search input to lowercase before looking up the key. `portalUserId` inside the JSON preserves the preferred display casing.

## Canonical V1 record

```json
{
  "schemaVersion": 1,
  "portalUserId": "Rishabh1704",
  "firstName": "Rishabh",
  "loginPassword": "A1bc",
  "answerPassword": "Z9xy",
  "schoolYear": 5,
  "vrEligible": true,
  "accountStatus": "active",
  "expiresOn": null,
  "batches": ["Y5M11F1", "Y5E11F1"],
  "fullLibraries": ["maths-level2-full"],
  "manualLessonAccess": {
    "Y4E12": ["core", "vr"]
  },
  "specialAccess": ["vr-howto"]
}
```

## Fields

- `schemaVersion`: integer. Starts at `1`.
- `portalUserId`: immutable student username / Portal User ID. Comparison is case-insensitive.
- `firstName`: student-facing greeting name.
- `loginPassword`: current 4-character student login password. Manual-management V1 stores it in this private KV record.
- `answerPassword`: current 4-character password used for all protected Maths/English/VR answers.
- `schoolYear`: integer 2–6. Manually maintained; no automatic rollover.
- `vrEligible`: boolean. Controls whether a *new* Excel English entitlement also receives the `vr` component.
- `accountStatus`: `active` or `withdrawn`.
- `expiresOn`: `YYYY-MM-DD` or `null`. End-of-day Europe/London expiry when used.
- `batches`: array of current batch IDs. Used for current curriculum/navigation context, not as proof that an individual lesson was earned.
- `fullLibraries`: array of library IDs. Full Libraries are continuing/dynamic access sources.
- `manualLessonAccess`: object keyed by immutable Lesson ID. Value is an array containing `core` and/or `vr`. This is the manual correction/grant mechanism outside Excel.
- `specialAccess`: array for non-standard content areas such as `vr-howto` and future special collections.

## Password rule

Both `loginPassword` and `answerPassword` are exactly 4 characters and contain at least:

- one uppercase letter;
- one lowercase letter;
- one digit.

## Manual-management security decision

V1 intentionally keeps the current passwords directly readable in the private student KV because student administration is being performed manually rather than through an Admin console. The browser must never receive the stored password as part of a student profile response. Login verification happens in the Worker, and the browser will later receive an opaque session rather than storing/replaying the password.

## Entitlement-source separation

Do not write Excel-earned lesson entitlements into this JSON. They live in D1.

Effective lesson access is the union of:

1. Excel-earned D1 entitlement;
2. `manualLessonAccess`;
3. an applicable `fullLibraries` entry.

A manual change to one source must not silently destroy another source.

## Academic-year rule

Every academic year starts with newly created/reassigned batches. There is no automatic student batch rollover. Updating `schoolYear` and `batches` is a manual annual operation. Historical entitlements are not removed when these fields change.

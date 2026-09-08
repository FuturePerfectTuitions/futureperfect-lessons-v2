# Portal V2 Change 17 — Parent transactional email from CSV import

Change 17 adds parent transactional email delivery to the existing Admin Lesson Release CSV import.

## Trigger rules

- Upcoming: `Mode` contains `O` and `LessonStatus` is exactly `Ready` (case-insensitive).
- Completed: `LessonStatus` contains `Completed`, except the explicit phrase `Not Completed`.
- Ongoing: `LessonStatus` contains `Slide` and is not a Completed status.

Priority is Completed, then Ongoing, then Upcoming.

## Contact and content rules

- Parent greeting comes from CSV `Parent`.
- Parent recipient comes from CSV `Email`, which is sourced from the workbook Email Database.
- Sender: Sejal Dalal `<sej@futureperfect.education>`.
- CC: Barkha `<barkha@futureperfect.education>`.
- PreLesson Sheets are never attached. Upcoming mail states whether sheets are available on the Portal.
- Completed and Ongoing templates always refer to homework; FPT business rules state every lesson has homework.
- `PLSS Informed` and `HW Informed` are deliberately ignored.
- Duplicate parent sends are currently permitted by business decision.

## Lesson code normalisation

For normal Year 4/5/6 rows, the CSV `Year` column is authoritative. An incoming `L1/L2/L3` lesson prefix is rewritten to `Y4/Y5/Y6` respectively before Portal lookup and email display. Rows whose Year contains `11+` retain their legitimate `L1/L2/L3` lesson codes unchanged.

## Delivery architecture

The existing Portal entitlement importer remains authoritative and is executed first. Parent email is attempted only after a successful Confirm Import response. Email failure is reported separately and does not roll back Portal entitlement writes.

The FPT graphical signature is embedded as one inline CID PNG. No lesson-resource attachment is added.

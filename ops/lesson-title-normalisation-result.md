# Live lesson title normalisation result

Date: 2026-09-07
Workflow run: 34119207411
Result: PASS

## Scope

- LESSONS_KV `lesson:*` keys scanned: 374
- Core curriculum lessons identified by Years 2–6 / Level 1–3 Maths-English display IDs: 355
- Titles requiring correction: 16
- Residual legacy titles after final live re-read: 0

## Live title changes

- `lesson:Y2M1.1`: `Lesson 1.1 Money` → `Money`
- `lesson:Y2M1.2`: `Lesson 1.2 Money` → `Money`
- `lesson:Y2M10`: `Lesson 10 2 and 3 digit division` → `2 and 3 digit division`
- `lesson:Y2M12`: `Lesson 12 Number and Place Value` → `Number and Place Value`
- `lesson:Y2M13`: `Lesson 13 Additions and Subtractions` → `Additions and Subtractions`
- `lesson:Y2M14`: `Lesson 14 Partitioning` → `Partitioning`
- `lesson:Y2M15`: `Lesson 15 Word Problems` → `Word Problems`
- `lesson:Y2M2.1`: `Lesson 2.1 Multiplication and Division` → `Multiplication and Division`
- `lesson:Y2M2.2`: `Lesson 2.2 Multiplication and Division` → `Multiplication and Division`
- `lesson:Y2M3`: `Lesson 3 Statistics` → `Statistics`
- `lesson:Y2M4`: `Lesson 4 Fractions` → `Fractions`
- `lesson:Y2M5`: `Lesson 5 Shapes` → `Shapes`
- `lesson:Y2M6`: `Lesson 6 Measurements` → `Measurements`
- `lesson:Y2M7`: `Lesson 7 Time` → `Time`
- `lesson:Y2M8`: `Lesson 8 Position and Directions` → `Position and Directions`
- `lesson:Y3M2`: `Lesson 2 Number and Place Value` → `Number and Place Value`

## Guardrails used

Only a leading embedded curriculum display code and/or a legacy `Lesson <number>` / `Lesson <number.number>` label was removed. The remainder of the title was preserved exactly. Legitimate title numbers such as `Statistics 2`, `Fractions 4` and `Money 2` were not removed. Every changed KV record was re-read after writing and compared against its pre-change record with the `title` field excluded; the workflow passed only after confirming no non-title field changed and no residual legacy title remained in the scoped curriculum set.

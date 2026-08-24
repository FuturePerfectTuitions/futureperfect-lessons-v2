# Phase 11 — canonical catalogue metadata gate

Status: **STRUCTURALLY COMPLETE; METADATA GATE OPEN**

After the verified 1,669-object R2 upload, the complete Phase 11 canonical catalogue was rebuilt against the locked canonical IDs, reviewed resource pairings, confirmed Year 5 English 11+ supplement anchors, explicit ScreenPal URL rules and the final 11+ additional-resource model.

## Structural catalogue result

- canonical ordinary lessons: **369**
- canonical curriculum records: **11**
- exact R2 object references: **1,669**
- unique R2 object references: **1,669**
- uploaded R2 objects missing from catalogue: **0**
- catalogue references not present in the reviewed R2 corpus: **0**
- explicit approved ScreenPal quiz records: **79**
- lessons with VR material represented: **66**
- 11+-only additional non-Homework/non-PreLesson resources: **9**

The nine 11+-only additional resources are the eight reviewed Y5E2 creative-writing tasks plus the Y5E19 Display Posters PDF. They use the dormant Phase 11 final adapter and are not exposed in normal presentation views.

## Metadata source coverage

The read-only audited legacy `FPT_LESSONS` source provides a source-grounded description and trusted standard ScreenPal video reference for **123 of the 369 canonical lessons**.

The remaining **246 lessons** have neither a description nor a main ScreenPal video reference in the audited legacy catalogue source. Phase 11 deliberately leaves those values absent rather than inventing text or deriving unconfirmed provider IDs.

Coverage by canonical curriculum:

| Curriculum | Lessons | Description + video present | Metadata gaps | R2 references |
|---|---:|---:|---:|---:|
| ENGLISH_Y2 | 29 | 0 | 29 | 72 |
| ENGLISH_Y3 | 32 | 0 | 32 | 83 |
| ENGLISH_Y4 | 34 | 5 | 29 | 294 |
| ENGLISH_Y5 | 32 | 5 | 27 | 276 |
| ENGLISH_Y6 | 31 | 0 | 31 | 90 |
| MATHS_L1 | 36 | 34 | 2 | 170 |
| MATHS_L2 | 38 | 37 | 1 | 217 |
| MATHS_L3 | 43 | 42 | 1 | 197 |
| MATHS_Y2 | 36 | 0 | 36 | 109 |
| MATHS_Y3 | 34 | 0 | 34 | 95 |
| MATHS_Y6_EXTRA | 24 | 0 | 24 | 66 |

## Apply boundary

The guarded production-data LESSONS_KV apply is **not permitted yet** because the authoritative Phase 11 population rule requires source-grounded lesson metadata. The catalogue generator is structurally ready, but `applyReady` remains false until one of the following is established for the 246 gaps:

1. another authoritative source supplies the real description and ScreenPal reference; or
2. the FPT owner confirms that those lessons intentionally have no description/video at present and that the canonical record should store those fields as absent.

No existing live portal, student permission, D1 entitlement, or production Worker state is changed by this gate record.

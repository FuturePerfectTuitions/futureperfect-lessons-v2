# Repository instructions for coding agents

## Important repository boundary

This repository, `FuturePerfectTuitions/futureperfect-lessons-v2`, is **not the canonical live student-facing Portal V2 frontend repository**.

The live frontend served at `https://lessons.futureperfect.education` is:

`FuturePerfectTuitions/futureperfect-lessons-test`

## Mandatory targeting rule

If the user asks for a live Portal V2 HTML, CSS, JavaScript, layout, styling, navigation, button or other student-facing frontend change, do **not** edit the frontend copies in this repository unless the user explicitly says to work on the development copy.

For live frontend work, switch to `FuturePerfectTuitions/futureperfect-lessons-test`, verify its root `CNAME` contains `lessons.futureperfect.education`, and inspect its `index.html` for the currently loaded assets.

## What remains here

This repository contains Portal V2 development/history plus Worker/backend, tests, operations and deployment material. Do not delete files here simply because the frontend is live elsewhere; first prove that a file is unreferenced by Worker builds, workflows, tests, scripts, deployment or rollback paths.

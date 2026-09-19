---
date: 2026-09-19
last_updated: 2026-09-19
purpose: The design contract for F39 "Garden Walk" — bulk photos onto existing trees, identified deterministically (human tag, bound code, separator shot, walk order), queued on the phone, analyzed now or later in one strictly sequential run. This is what we build to and what we review against.
parent: Citrus Care PRD v1 §6
related: docs/research/plant-tagging-garden-walk.md · docs/design/plant-tools.md · CLAUDE.md (D-17 hard rules) · ~/.claude/plans/review-again-what-i-polished-cray.md (the approved build plan)
status: approved 2026-09-19, being built phase by phase
sources:
  - docs/research/plant-tagging-garden-walk.md (ISA, Bartlett, Arnold Arboretum, USFS/MSU, i-Tree, Hectre, herbarium digitisation, gps.gov, PLOS ONE canopy study; source-verified)
  - Google ML Kit Terms of Service, updated 2025-05-14 (server contact + usage metrics clauses)
  - expo-camera 57, expo-image-picker 57, expo-file-system 57, react-native-executorch 0.9.2 (installed source, read this session)
  - jsqr 1.4.0 (Apache-2.0), jpeg-js 0.4.4 (BSD-3) — pure-JS decoders
---

# Garden Walk — design contract (F39)

## 1. What this is

A **walk** is a set of photos that arrive faster than the phone can analyze them: ten to fifteen trees shot in-app in a row, or yesterday's stock-camera roll imported in one go. Each photo has to land on the **right existing plant**, and the 25–120 s on-device analysis has to happen later, in order, without the user standing in the garden for it.

Today the app cannot hold a photo that has no assessment — the photo index is keyed by assessment id (`photo-store.ts`) and `runAssess` links the file only after the model succeeds. Snap-first (F35) turns an unassigned photo into a **new** plant, so a garden of five lemon trees becomes five plants called "Lemon". Nothing about an in-progress capture is persisted, so a process kill loses it.

Garden Walk adds one new store (the **photo queue**), two identifiers on the plant record (a human **tag** and bound **codes**), an optional **zone + walk order**, a **review screen** where every photo's plant is visible and cheap to change before any compute is spent, and a **run screen** that analyzes the queue one photo at a time under the existing 25 s / 120 s budget.

## 2. The one idea everything is built on

**Deterministic, explicit evidence decides which plant a photo belongs to; the model never does.** The vision model's `plant_guess` is species-level, confidence-free and absent when unsure — it cannot tell two lemon trees apart, and F35 already fixed the stance that recognition never auto-decides. So identity comes from things the phone can verify: the chip the user set, a code the user bound to a plant, a number the user wrote on a stake and typed, a separator photo the user shot on purpose, or a walk order the user saved. Everything softer (a time-gap group, a filename token) is a **suggestion** that the review screen shows and the user confirms with one tap. Unassigned photos are never analyzed and never lost.

The second idea follows from the first: **misattribution is the failure mode**, not slowness. A wrong binding corrupts a timeline the user cannot re-shoot, so the review screen — where a mistake costs one tap — is worth more than any capture-time cleverness, and every automated assignment carries a visible `evidence` badge until the run commits it.

## 3. Locked decisions

Each decision names what it rules out and why. Changing one means re-opening this section, not working around it.

- **D-W1. A photo without an assessment lives in its own queue store, never as a placeholder assessment.** `citrus.photo-queue.v1`, keyed by its own id (the prune-store precedent: "a pruning plan is not an assessment"). A record **leaves the store when its assessment lands** — file ownership passes to the photo index. Identity lives in the record and the plant directory, never in the filename. *Why:* placeholder assessments would poison `latestScore`, trend, cover, the watering anchor, the timeline and the backup; an ever-growing blob rewritten per model call is not acceptable.
- **D-W2. Every walk photo is durable before anything else happens.** The 1600 px manipulator output is *moved* into `photos/_inbox/`, recorded, then moved into its plant directory (same-volume renames), so one orphan sweep covers every kill window; picker copies and manipulator temps are deleted; records store a **basename**, never an absolute uri (the uri is rebuilt through the one guarded `plantPhotoDir` helper); `analyzing` + `startedAt` are persisted before the model runs; automatic re-runs are capped at three (`attempts`) while a user Retry or a reassign resets the count; the reconcile + sweep run once per process, the sweep is age-gated (files younger than 10 min are left alone), and neither runs while a run or an enqueue is in flight. *Why:* the manipulator cache is evictable, React state dies with the process, and the sentence "finished photos are already saved" must be true by construction.
- **D-W3. The identification ladder.** Explicit per photo or per group › explicit run ("also the photos after this one, until the next one I assign") › scanned code with exactly one owner › tag-card (a QR hit on an imported photo) or a user-marked **tree-marker photo** › gap-grouped propagation (≤ 4 photos per group) › filename marker token (suggestion) › unassigned. **No "Accept all."** Scanned payloads match only bound codes, never human tags. *Why:* at one to three shots per tree, seconds apart, an unbounded time window chains a whole roll onto the first tree and one header tap commits it; numeric tags ("7") must never be matched by a stray payload or a filename token.
- **D-W4. Two identifiers on the plant record; the human number is co-primary.** `tag` — whitelisted (`/^[A-Z0-9 _.#-]+$/`, ≤ 24, unique), entered via a 56 dp numeric tag grid or search; `codes` — SHA-256 digests of normalized payloads from any pre-printed QR sticker, several per plant, moved only from the plant's own Tags card. The app can **generate** an opaque plant code (`CC1-…`, no meaning encoded) for the user to write or print elsewhere; it does not print. *Why:* every professional system keys on a number on a durable tag, and the affordable hardware for many trees is pre-numbered aluminium (research §3–4); binding an existing sticker needs no printer; a digest means no third-party payload is ever stored, rendered or backed up. Both ride backup v3 with no version bump and cascade with the plant.
- **D-W5. The batch is strictly sequential over `runAssess(savedUri)`.** Never `Promise.all`. The runner awaits `whenIdle()` (30 s cap) before every item, two consecutive timeouts end the run as "struggling", cancel is "Stop after this photo", and **no user tap ever calls `interrupt()`**. *Why:* the 120 s budget starts at enqueue and `interrupt()` is global (D-P9), so fanning out lets photo #5's ceiling kill photo #1; a hard-timed-out inference keeps running natively and would eat the next item's clock; and `interrupt()` makes `generate()` **resolve with partial text** (verified in `LLM.cpp`), so a cancelled item's truncated diagnosis could parse and persist.
- **D-W6. The comparison anchor is per (plant, walk).** Captured when the plant's first photo of that walk starts, persisted (`runAnchorIso`), reused on resume and retry; runnable order is walk-then-time so visit two compares against visit one. Never a global time window. Single-shot `ReviewScreen` semantics are byte-identical. *Why:* two angles of one tree 40 s apart must not read "Worse"; "Analyze all pending" can mix walks; a global window would silently change the tested single-shot flow.
- **D-W7. "Analyze now / Later" is asked every time; walk mode is a remembered, visibly checked viewfinder toggle** (default off, disabled with zero plants) with a mode line under the chip. *Why:* the user's explicit answer; a mode that changes what the shutter does must be visible in sun.
- **D-W8. Progress is a true count plus phase labels plus "about N min" from measured durations** (a persisted ring of the last 30 item durations). Never a percentage bar for inference; before any history, "up to 2 minutes per photo". The line about leaving the app is tiered on the keep-awake probe and is true by construction. *Why:* 25 s is a slow *hint* and 120 s is a *kill* — neither is a duration.
- **D-W9. The cover is chosen once per plant at run end, whole-plant first** (`updateCover: false` during the run). *Why:* last-persisted-wins made the card thumbnail whichever photo happened to run last.
- **D-W10. The runner never schedules reminders.** The summary opens `DiagnosisScreen` per plant (where "Remind me" lives) and offers one bulk "Remind me to re-check these N plants" made safe by **replace-don't-stack** (`kind: "recheck"`; legacy kind-less reminders count as recheck). *Why:* the #3 north-star loop lives only in `DiagnosisScreen`, and `scheduleReminder` had no de-dupe.
- **D-W11. The queue is excluded from backup v3** (comment + test + on-card copy); `tag`/`codes`/`zone` ride the plant store; import never overwrites; `restorePhotos` keeps the incoming entry's `createdAt`; **export caps carried photos by bytes** (newest first, 120 MB) and says "Backup includes N of M photos". *Why:* the photo carrier is keyed by assessment id; a queue record on a dead uri is worse than none; base64-encoding every photo into one string is O(all photos) in memory and walks multiply photos.
- **D-W12. No GPS, no NFC, no new native dependency, no Google ML Kit.** Two justified pure-JS dependencies (`jsqr`, `jpeg-js`). One `app.json` change: expo-camera `barcodeScannerEnabled: false`, which strips ML Kit from the APK. *Why:* consumer GNSS is 4.9 m under open sky and 2–10 m under canopy against 3–5 m tree spacing; NFC reads at 0–3 cm and forces minSdk 31; everything else needed is installed; removing ML Kit strengthens D-17.
- **D-W13. Scanned payloads, EXIF and file names are untrusted physical-world input.** Payloads: NFKC, strip `\p{Cf}` and controls, cap 256, reject the literal strings "null"/"undefined", digest, compare-only. EXIF: a pure `pickExifDates` whitelist (`DateTimeOriginal`, `SubSecTimeOriginal`, `OffsetTimeOriginal`, `DateTimeDigitized`, `DateTime`) applied immediately; the raw object is dropped; GPS keys are never read, stored or logged. File names: capped at 80, never a path segment. A Security Assessment Log row is written at Phase 1 and amended at Phases 3 and 4.
- **D-W14. Photo-time dating and the watering-anchor change ship as their own gated phases** (5 and 6), each with its own PRD row. *Why:* both change the meaning of existing data for existing users.
- **D-W15. No Google ML Kit, anywhere.** Its Terms (2025-05-14) state the APIs "may contact Google servers from time to time" and "send metrics about the performance and utilization of the APIs in your app to Google" — a third network destination that the airplane-mode test cannot rule out (metrics can flush later). Codes are decoded by `jsqr` on `jpeg-js` pixels from a **deliberately captured, 800 px** photo ("Scan tag" button); import-side decoding runs on the 800 px copy. QR only in v1.
- **D-W16. Every record id and photo basename is validated at every parse boundary.** `isSafeRecordId` accepts `newLocalId` output **and** UUIDs (Gemini-era photo-index ids) and rejects `..`, `_inbox`, separators, empty, overlong; `isSafeBasename` accepts `photoFileName` output only; `parsePlantStore` requires key === id; `plantPhotoDir` is the only constructor of a photo directory. *Why:* a pre-existing traversal gap (a restored plant `{ id: ".." }` deleted on this phone would delete `documents/`), which this feature would have widened with four more plant-keyed filesystem primitives.
- **D-W17. Store-size honesty.** `canRunBatch` refuses "Analyze now" when the projected AsyncStorage total would exceed a soft 5 MB of the Android 6 MB default; Profile → Your data shows "Records: x of 6 MB · Photos: y MB"; raising the cap via a local `withGradleProperties` plugin is priced in Phase 7, not shipped.
- **D-W18. A throwing `mark()` stops the run** (`endedBy: "storage-error"`, outcomes kept in memory for the summary); the next launch's reconcile repairs on-disk state. Leaving the app mid-run requests stop-after-current and the screen says "Paused when you left". *Why:* continuing with desynced statuses turns one storage failure into a cascade; screen-off behaviour is unmeasured.

## 4. Module map

Pure modules (vitest, no expo/react-native imports; arch-guard enforces):

| Module | Owns |
|---|---|
| `local-id.ts` | `newLocalId`, `isSafeRecordId`, `isSafeBasename` |
| `photo-queue.ts` | the queue store: records, marks, `runnableItems`, `groupByGap`, `propagateWithinGroup`, `reconcileInterrupted`, `pickWalkCover`, durations ring, parse/serialize |
| `photo-import.ts` | `pickExifDates`, `parseExifDateTime` (local instant), `takenAtFromAsset`, `orderImportedPhotos`, `fileTagToken`, `classifyScan`, `assignByTagCards`, `applyPlantToRun`, `importSummary` |
| `plant-tags.ts` + `sha256.ts` | `normalizeTag`, `normalizeCode`, `codeDigest`, `codeDisplay`, `plantByCode`, `codeOwners`, `tagConflict`, `suggestNextTag`, `generatePlantCode`, `interpretScan` |
| `qr-decode.ts` | `decodeQrFromRgba` (jsqr), `scanTargets` |
| `walk-runner.ts` | `runWalk`, `estimateRemainingMs`, `expectedCopy`, `progressLabel`, `phaseLabel`, `summarizeWalk`, `batchReminderPlan` — **must never contain the text `generate(`** (a local guard test mirrors arch-guard) |
| `walk-order.ts` | `nextInWalk`, `prevInWalk`, `groupByZone`, `sortByStaleness`, `bulkPlantDrafts` |
| `storage-budget.ts` | `canRunBatch`, `formatStorageSize`, `storageSummary` |
| `csv-export.ts` | `plantsToCsv` |
| edits | `assessment-store.ts` (`comparisonAnchor`, `byCreatedAtDesc`, `removeAssessment`, `takenAt`/`effectiveTime` in Phase 5), `plant-store.ts` (`tag`, `codes`, `tag_photo`, `zone`, `walk_order`), `backup.ts` (`selectBackupPhotos`, id validation), `reminders.ts` (replace-don't-stack), `watering.ts` (Phase 6 anchor), `capture-modes.ts` (`WALK_MODE_KEY`, `filterPlantsByQuery`) |

IO and UI (untested by policy; exercised by `tsc` + `expo export` + device V12):

| File | Owns |
|---|---|
| `photo-queue-io.ts` | load/save, `enqueueWalkShot`, `importGalleryAssets`, `assignQueuedPhoto` (move), `removeQueuedPhoto` (delete), cascade, `recoverInterruptedWalk` + `sweepInboxDir` |
| `qr-decode-io.ts` | `readJpegRgba` (jpeg-js), `decodeQrFromPhoto` (800 px + tile retry), `captureAndDecode` |
| `photo-store-io.ts` | `plantPhotoDir` — the single guarded directory constructor |
| `local-engine-io.ts` | `persistLocalAssessment(input, { compareBeforeIso, updateCover, takenAt })` |
| `components/assess-deps.ts` | `buildAssessDeps(localEngine, size, context, overrides)` — lives outside `src/lib` because it contains the model call |
| `components/LocalEngineProvider.tsx` | the FIFO mutex, `interrupt`, and the one addition `whenIdle()` |
| screens | `CaptureScreen` (walk toggle, sticky/carried chip, Scan tag, Done · N, Next/Prev, multi-select import), `WalkReviewScreen` (sectioned review + the every-time question), `WalkRunScreen` + `WalkSummary` (the run), `PlantDetailScreen` (`PendingPhotosStrip`, `PlantTagsCard`), `PlantsScreen` (`PendingWalkCard`, zone grouping) |

## 5. Deliberately not built

| Not built | Why |
|---|---|
| Google ML Kit live or still-image scanning | D-W15 — its terms send usage metrics to Google |
| GPS / EXIF location, NFC | D-W12 — physics and ergonomics, plus a native dependency each |
| Model-based identity for existing plants | D-W3 — species-level, confidence-free; a species-sorted picker section is a later suggestion at most |
| Placeholder assessments / a generalized photo index | D-W1 — blast radius across every mapper and the backup carrier |
| Background or headless analysis | no task-manager or foreground service installed; the screen says the user cannot leave rather than letting them find out |
| "Stop now" via `interrupt()` | D-W5 — verified partial-resolve hazard and the global interrupt |
| Auto-reminders after a batch | D-W10 |
| A global comparison window | D-W6 |
| "Accept all" suggestions; auto-advancing the walk order | D-W3 / research — rank, never commit; a silent skip shifts every later photo |
| Printing tag sheets in-app | needs a QR encoder plus view-shot/print; numbered aluminium outlives print; Phase 7 export at most |
| A determinate progress bar for inference | the count is honest; a percentage would not be |

## 6. How we know it works

Automated (every phase): `npx tsc --noEmit`, `npx vitest run` (pure modules incl. the runner's sequencing, the reconcile cases, the traversal test, the EXIF local-time parse, the QR decode fixture), arch-guard green with zero edits, `npx expo export --platform android`.

Device V&V "V12 Garden Walk" (Test Plan): import 12 stock-camera photos → sections ordered by shooting time regardless of tap order; Later → banner → kill → relaunch → still 12; the run analyzes one at a time with honest copy and no Close; kill mid-item → waiting or assessed, never both; two consecutive timeouts stop the run; not-a-plant rows are kept unscored; covers and deltas compare to the pre-walk visit; walk mode with a stake number and a pre-printed URL-shaped QR (bind, switch, tags card, nothing opens, no network in `logcat`); import-side tag cards; photo-time dating on an old roll; delete cascade; storage lines and the store guard; memory log over 20–30 photos.

Phase 0 device probe (recorded here when run): multi-select dims/EXIF/order/latency; keep-awake through three sequential runs under the capture Modal at a 30 s timeout; `jpeg-js` + `jsqr` decode time and hit rate at ≥ 50 % / 15 % / 5 % of an 800 px frame; twelve sequential runs with `dumpsys meminfo`.

### Known gaps, recorded rather than fixed

- An assessed photo attached to the wrong plant still cannot be moved; "Undo this walk" (Phase 6b) removes a whole walk's assessments instead.
- Photo-time dating (Phase 5) does not recompute later rows when an older photo is imported between two existing ones.
- Only QR is decoded; DataMatrix/Code-128 stickers need `@zxing/library` (Phase 7).
- The AsyncStorage cap is guarded, not raised (Phase 7).
- EXIF time without `OffsetTimeOriginal` is taken as device-local wall clock; a roll shot in another timezone is ordered correctly within itself but dated in local time.
- Keep-awake under an RN `Modal` window is unproven until the Phase 0 probe; the copy has two tiers for that reason.
- **Plant-directory orphans are not swept yet (Phase 1).** D-W2's "one orphan sweep covers every kill window" holds for `_inbox` only: a kill in the millisecond between `enqueueWalkShot`'s second move and its record write, or between `assignQueuedPhoto`'s move and its record write, leaves one unreferenced ≤ ~400 KB JPEG inside a plant directory (the Profile storage line still counts it; `assignQueuedPhoto` now finishes a half-done move instead of failing). Phase 2 adds the plant-directory sweep to `recoverInterruptedWalk` — files named by no queue record, photo-index entry or prune plan, behind the same 10-minute age gate.
- **`reconcileInterrupted` matches by (plant, `createdAt ≥ startedAt`) when the photo index has no entry for the assessment** — nothing ties the assessment to the photo, so a single-shot assessment of the same plant made after a kill would settle the queued record and orphan its file. Unreachable in Phase 1 (nothing sets `analyzing`); the Phase 2 runner **must** pass the queued file as the assessment's `savedUri` so the index entry names the queue basename, and the reconcile then matches on that basename first.
- `removeQueuedPhoto` on a file the photo index already owns keeps the file and drops only the stale record (a refusal would leave a ghost record and a permanent "waiting" card); the safety property is "never delete an assessment's file", which holds.

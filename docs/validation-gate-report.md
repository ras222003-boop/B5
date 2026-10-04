# Basira Validation Gate report

**Date:** 2026-10-04  
**Repository:** `ras222003-boop/B5`  
**Decision:** **NO-GO — Engineering evidence is positive, but controlled field validation is not yet authorized.**

This report records observed results only. It does not claim a physical phone,
real screen reader, blind-participant, or real-building test.

## Evidence summary

| # | Check | Result |
| ---: | --- | --- |
| 1 | Starting `main` | `e568ede1847f8843664916590350a65dd8e767f8` |
| 2 | Branch | `codex/validation-gate` |
| 3 | Baseline regression | `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm build`, and `git diff --check` passed; baseline was 185 tests. |
| 4 | MySQL availability | Docker 29.8.1 and Compose v5.5.1 available; MySQL CLI absent. An isolated `mysql:8.4` container was used on `127.0.0.1:33067`. |
| 5 | Fresh migration | **PASS** in fresh5: 4 B6 tables, 4 building columns, 2 foreign keys. |
| 6 | Existing B5→B6 migration | **PASS** in upgrade2. Existing rows for floors, places, nodes, edges, saved places, and map versions were preserved. |
| 7 | Idempotency | **PASS**: `ensureSchema()` ran twice in fresh and upgrade fixtures. |
| 8 | Organization flow | **PASS** with real Better Auth sessions and MySQL: global admin → organization → membership → building → floor. |
| 9 | Official import | **PASS**: preview, review, approval, B1 graph write, version increment, and audit log. |
| 10 | Invalid import rollback | **PASS** for dangling edge, duplicate node, invalid floor, cross-floor `CORRIDOR`, cross-floor `DOOR`, malformed JSON, and oversized JSON. Seven invalid cases returned errors without partial B1 writes. |
| 11 | RAMP on real DB | **PASS**: two-floor `RAMP` import approved; `path_type=RAMP`, `has_ramp=1`, `has_stairs=0`, version incremented, and Route Planner used the transition. |
| 12 | Browser runtime | **PASS**: Chromium against the running local server had no page errors or unexpected failed requests on the tested routes. |
| 13 | Browser E2E count | 10 scenarios: 8 route smoke cases plus language/zoom and camera/offline cases. Each route also ran keyboard and axe checks. |
| 14 | Camera simulation | **PASS — browser camera simulation only**: fake camera permission, stream start, stop, and ended/removed tracks. No physical camera claim. |
| 15 | Vision/WASM runtime | The Vision page reached `جارٍ تحليل البيئة` with no page error. The optional SegFormer path reported its designed graceful warning; full model accuracy and device WASM performance remain unmeasured. |
| 16 | OCR Arabic/English/Chinese runtime | The local OCR fixture suite passed for `ar`, `en`, and `zh-CN`; browser route startup did not crash. Real camera sign accuracy was not measured. |
| 17 | OCR flaky check | `server/ocr.test.ts` passed 25/25 three consecutive times (about 13.27–14.03 seconds per Vitest run). The expected provider-failure log was emitted by the test. |
| 18 | TTS/STT | Chromium exposed `speechSynthesis` with 4 voices and `SpeechRecognition`/`webkitSpeechRecognition` in this run. This proves capability detection only; no real microphone speech-recognition session was claimed. |
| 19 | Automated accessibility | Axe on Navigation, Permissions, Capabilities, Vision, Mapping, Guidance, Shared Map, and Indoor Manager reported no violations after fixes. This is not a screen-reader test. |
| 20 | Keyboard navigation | `Tab`, `Shift+Tab`, and `Escape` smoke checks passed on all 8 route cases; focus did not fall back to `body`. |
| 21 | RTL/LTR | Browser runtime reported Arabic `rtl`, English `ltr`, and Simplified Chinese `ltr`; all three rendered non-empty Navigation content. |
| 22 | 200% zoom and small viewport | 390×844 viewport and 200% CSS zoom smoke passed without the tested horizontal-overflow threshold. This is not WCAG certification. |
| 23 | Offline/PWA | **PASS for the tested shell** after fixing runtime asset caching: registered and controlled service worker, offline reload returned non-empty shell content, and only bounded public assets/maps are eligible for cache. Private/auth endpoints are excluded. |
| 24 | SavedPlace IDOR | **PASS** on real MySQL/HTTP flow: another user received no data and could not GET, PATCH, or DELETE the first user's saved place. |
| 25 | Organization authorization | **PASS**: ordinary user was denied organization building/role operations and official approval paths. |
| 26 | B5 authorization | **PASS**: ordinary user was denied contribution review and rollback paths in the real HTTP flow. |
| 27 | Resource cleanup | Camera stop removed the stream tracks; Vision unmount cleanup was exercised by route/context teardown. Repeated physical-device worker and battery behavior remains untested. |
| 28 | Performance baseline | Route first-render smoke was roughly 5.2–10.1 seconds in headless Chromium. Build output: main JS 1,335.09 kB (383.94 kB gzip), navigation chunk 25.94 kB, Vision page 13.61 kB, Vision bundle 143.58 kB, Transformers 883.13 kB, and WASM 21,596.02 kB (5,087.10 kB gzip). No phone memory/thermal measurement was made. |
| 29 | CI | Added `.github/workflows/validation.yml`: frozen install, check, test, build, and both real-MySQL validation modes using a MySQL 8.4 service. It uses no OAuth or repository secrets. |
| 30 | Physical Android | **Not tested.** See [`device-validation-checklist.md`](device-validation-checklist.md). |
| 31 | Physical iPhone | **Not tested.** See [`device-validation-checklist.md`](device-validation-checklist.md). |
| 32 | Real screen reader | **Not tested.** NVDA, VoiceOver, and TalkBack checklists are prepared in [`screen-reader-checklist.md`](screen-reader-checklist.md). |
| 33 | Real building | **Not tested.** King Khalid University — Faculty of Education and Room 121 remain a planned scenario only; no map or route was asserted as real. |
| 34 | Bugs found | Better Auth IDs were opaque strings rather than UUIDs; Footer text failed automated contrast; four navigation pages nested a second `main`; service-worker asset caching failed when `Content-Length` was unavailable. |
| 35 | Bugs fixed | Membership validation now accepts bounded opaque Better Auth IDs; Footer contrast was raised; nested landmarks became content containers; bounded service-worker caching now measures a cloned body when needed and stores assets safely. |
| 36 | Unresolved blockers | Physical device performance/permissions, real screen-reader behavior, real building map review, and supervised route safety evidence are still missing. Optional SegFormer did not complete in the browser smoke and only its graceful fallback was observed. |
| 37 | `pnpm check` | **PASS**. |
| 38 | Test count | **186/186 passed** across 23 files after the Better Auth ID regression test was added. |
| 39 | `pnpm build` | **PASS**. Vite and server bundle completed; large-chunk warnings are recorded above. |
| 40 | `git diff --check` | **PASS**. |
| 41 | Commits created | `e08cdf7 fix(validation): close browser and auth validation gaps`; `e8b8ab9 test(validation): add reproducible validation gate`. |
| 42 | Latest SHA | `fc5a14f` was the latest SHA when this report was written; the final task response verifies the post-report SHA with `git rev-parse HEAD` and `git ls-remote`. |
| 43 | GitHub branch | [codex/validation-gate](https://github.com/ras222003-boop/B5/tree/codex/validation-gate) |
| 44 | Pull Request | Not created: GitHub compare was available but the connected browser was signed out, and the user made PR creation optional. Branch link is available above. |
| 45 | Mergeability | No PR was merged. GitHub's compare page reported **Able to merge / these branches can be automatically merged** for `main...codex/validation-gate`. |
| 46 | `git status` | Clean after the final commit and push; the final response reports the exact output. |
| 47 | `main` | Not modified directly. Work began from the recorded `main` SHA on `codex/validation-gate`. |
| 48 | Force push | Not used. |
| 49 | Final GO / NO-GO | **NO-GO** for controlled field validation. |
| 50 | Exact decision reasons | Engineering and privacy checks are positive, but the required physical Android/iPhone run, real screen-reader session, verified KKU map, sighted route review, and supervised safety walkthrough have not happened. |

## Reproducible commands

```bash
pnpm check
pnpm test
pnpm build
git diff --check

# isolated local MySQL only
DATABASE_URL=mysql://root:<local-password>@127.0.0.1:33067/basira_validation_fresh \
  pnpm exec tsx scripts/validation-gate-db.ts fresh
DATABASE_URL=mysql://root:<local-password>@127.0.0.1:33067/basira_validation_upgrade \
  pnpm exec tsx scripts/validation-gate-db.ts upgrade

pnpm exec tsx scripts/validation-gate-browser.ts
```

The temporary MySQL container and its validation databases are test-only and
are removed after the gate. The application does not receive production
credentials from this process.

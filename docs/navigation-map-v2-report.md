# Basira Accessible Navigation Map — implementation report

Date: 6 October 2026. Branch: `codex/accessibility-navigation-map-v2`, created from `origin/main` at `7f79d5bd5d3bbe2388c1bf5cef838b8c08a26691`.

## A. Audit

The [pre-implementation audit and 24 classified ideas](navigation-map-v2-audit.md) records the baseline. The repository already has a production-shaped indoor navigation graph, private saved places, a weighted localization engine, guidance and rerouting, vision/OCR, mapper workflows, and a reviewed Shared Map. Its current routing is inside one building. GPS previously supplied one fix for building lookup and saving a point; it did not provide a pedestrian route. No ordinary-user saved-route model existed. The mapping workflow intentionally retains mapping-session tracks under mapper permissions, a separate data flow from ordinary navigation.

## B. Existing features reused

`RoutePlanner`, `BasiraNavigationEngine`, `TemporaryRouteConstraints`, `BasiraLocalizationEngine`, QR and motion providers, OCR place recognition, the existing speech engine and haptics, private saved-place APIs, map graph and version sync, and Shared Map review. Existing route arrival still requires proximity plus independent confirmation. Existing off-route debounce and TTL constraints remain.

## C. Missing features identified

Private learned route storage, learning/replay preference, return to start, a user-facing route drawing, explicit indoor LOST state, GPS accuracy disclosure, continuous outdoor approach, persistent public offline graph cache, and a haptic preference. Still missing after this increment: a verified outdoor pedestrian network, door-level coordinate calibration for buildings, fully automatic indoor floor detection, live reviewed hazard feed with server TTL, cross-building journey graph, and offline private route retrieval after closing the tab.

## D. Brainstorming ideas

24 ideas classified as MUST HAVE, HIGH VALUE, EXPERIMENTAL or FUTURE are in the audit. They include a compact private route template, freshness-aware replay, entrance confirmation, GPS quality, silent haptics, and future accessible crossing data.

## E. Additional ideas invented during implementation

The route-template integrity check rejects disconnected graph IDs and invalid floor transitions. A user report increments familiarity without turning it into a safety certification. The outdoor map marks the destination bearing as a **non-route**. Its trace remains in memory. Public map caching is separated from private journey data. A visual map redraw threshold reduces tiny motion redraws. A no-store POST moves the app's building lookup GPS coordinates out of the URL.

## F. Ideas implemented and deferred

Implemented: private saved routes with explicit naming and deletion; graph summary extraction; familiar preference with closure/risk/staleness checks; conservative reuse through fresh planning; arrival-reported learning; return to original indoor start; volatile breadcrumb edge memory; floor-specific map with completed/remaining edges and uncertainty; quality labels and LOST recovery; GPS quality/age/bearing/last reliable fix; approach notice; opt-out haptics with a distinct relocalization pattern; public offline graph cache; voice queue invalidation; save-place accuracy; GPS POST lookup. Existing Shared Map review is offered for a separate, explicit public suggestion.

Deferred: actual outdoor walking routes, multi-building learned journeys, automatic entrance/floor inference without an anchor, route-derived public suggestions, automatic server hazard TTL, and barometer/beacon/Wi-Fi adapters. These need trusted pedestrian/venue data, sensor validation, moderation policy or field studies. Details under Y and Z.

## G. Architecture

`Navigation` captures/saves a point; `Guidance` coordinates the current indoor engine, outdoor GPS approach, a compact journey prior, voice, haptics and map. `savedRoutes.ts` adds private APIs beside the existing navigation routes. `savedRouteDomain.ts` validates a client-submitted graph path and derives only decision nodes, floor transitions, mapped anchors and turns. `journey.ts` assesses reuse against the *current* graph; `RoutePlanner` applies a small discount to eligible familiar, low-risk edges and always recalculates. No saved speech instruction is replayed.

## H. Localization strategy

Indoor fusion continues to weight QR/NFC/manual/vision stronger than indoor GPS and inertial updates. A LOST or low-confidence fix suppresses precise instructions and asks for a known anchor. The displayed indoor uncertainty radius and sources come from the existing estimate. Outdoor GPS is a separate quality ladder: HIGH (≤10 m), MEDIUM (≤25 m), LOW (>25 m), LOST (stale >20 s or absent). Outdoor GPS does not assign an indoor floor.

## I. Routing strategy

The existing graph cost uses distance, map verification, access, stairs, visual friendliness and risk; closed edges are excluded. An eligible familiar edge gets a 22% cost discount only in RECOMMENDED mode and only while its live risk is LOW. If any saved edge is missing, disconnected, high risk or closed, the whole familiar preference is rejected; the ordinary planner seeks an alternative. A newly risky edge gets no discount. Return-to-start plans from the current trusted fix, using observed breadcrumb edges as a weak preference, while carrying active temporary constraints.

## J. Saved Route design

The additive `basira_saved_routes` table is owned by user ID and stores building, start/end node, a JSON graph template, map version, user-reported success count, smoothed typical duration and dates. The JSON has ordered node/edge IDs, floor transitions, mapped anchor node IDs and turn node IDs. It has no raw step stream, camera frame or GPS track. The POST endpoint accepts only a strict bounded schema, verifies graph membership/connectivity, rejects currently closed/high-risk edges, and returns private no-store responses. Deletion uses owner ID.

## K. Route learning

One reported arrival is `NEWLY_LEARNED`, two to four are `FAMILIAR`, five or more are `HIGH_CONFIDENCE` familiarity. The count is **user-reported**, not field verification. A repeat increments only when the actual recalculated edge sequence matches the saved template. The duration is a bounded moving average. Success is not a safety guarantee.

## L. Familiar route behavior

The user can toggle “أفضل المسارات المألوفة” and pick a saved route. Reuse requires the same destination, an origin on the same floor within 12 m, complete current graph IDs, no live closure/high risk, and a use within 180 days. Among eligible automatic matches, reported success count and then recency choose the prior. A stale or blocked template prompts an alternate-route message. The engine recalculates new instructions.

## M. Hazard handling

The pre-existing camera hazard fusion and transient route constraints remain. Current official map closures stop routing on an edge and trigger reroute on updates. The saved-route assessment rejects an entire familiar prior if one edge is closed/high risk or under an unexpired local constraint. Expired local constraints no longer block eligibility. Community issue reports still require review; they do not silently become active routing hazards.

## N. Outdoor/Indoor transition

The outdoor component watches GPS only after the user presses Start, reports accuracy and straight-line bearing, and notices two high-quality fixes within 25 m of the building coordinate. The building coordinate may represent the building center. It asks for a known entrance/QR. The existing QR/manual anchor then switches the experience to indoor graph guidance; GPS alone never establishes the floor. This is a conservative handoff, not fully automatic threshold-only indoor detection.

## O. Last-meter guidance

Within 20 m of the indoor destination at sufficient confidence, the UI gives one extra cue to check the door or room number. Existing OCR/visual recognition and manual confirmation still gate ARRIVED together with close, confident localization. No door-side cue is asserted without evidence.

## P. Privacy

Ordinary navigation breadcrumb edges and outdoor trace live only in page memory. Route retention requires a named save action after reported arrival. Saved places/routes are private authenticated records with deletion. Public map/floors/places can be cached for 30 days; private journeys are not put in persistent public cache. The app's current-building lookup sends GPS in a no-store POST body instead of a URL. The legacy GET remains for compatibility. Separate Shared Map contribution requires explicit consent and moderation, and does not publish personal route templates. Hosting/proxy access-log policy is outside this code change.

## Q. Accessibility

Large controls, named form fields, RTL layout, accessible SVG description, live status/alert text, repeat/where-am-I commands, speech-priority queue and optional haptics are present. Browser automation activates Start with the keyboard and finds the controls by accessible names. Axe reported **0 automated WCAG A/AA violations** on both indoor and outdoor browser fixtures. This is not a complete WCAG 2.2 AA audit, a screen-reader study, or a blind-user field evaluation. New journey controls are currently Arabic UI text; existing instruction/audio language choices remain Arabic, English and Chinese.

## R. Performance

Outdoor position rendering retains at most 60 fixes and records trace progress only after ≥4 m or ≥8 s. Ordinary navigation never uploads each GPS frame. The map memo comparator skips redraws for indoor movements under 1 m with unchanged route edge/floor and small heading/uncertainty changes. Public map cache writes are guarded against storage quota errors.

## S. DB changes

Additive migration `0009_saved_routes.sql` creates one private saved-route table. `ensureSchema` also adds nullable `accuracy_meters` to existing saved places. No destructive migration or data removal occurs. The migration was syntax-reviewed and built; it has not been applied to a real MySQL instance in this run.

## T. API changes

`GET /api/navigation/saved-routes`, `POST /api/navigation/saved-routes`, `POST /api/navigation/saved-routes/:id/success`, `DELETE /api/navigation/saved-routes/:id`; all require authentication and owner scoping. `POST /api/navigation/buildings/current` accepts a GPS fix in a no-store body. Saved-place POST/PATCH now accept optional GPS accuracy. The old GET building lookup remains.

## U. UI changes

Guidance has Journey Memory, familiar preference, save-after-arrival, delete, return-to-start, save-current-place, floor map, explicit location quality and recovery text, haptic setting, and an outdoor GPS approach panel. Navigation shows GPS accuracy, and My Places shows accuracy recorded at save time. Public route suggestions link to the existing separate consent flow.

## V. Tests and exact counts

`pnpm check` **PASS**; `pnpm test` **PASS**, 31 files and **222/222 tests**; `pnpm build` **PASS**; `git diff --check` **PASS**. The full test suite first exposed assertions that still expected the old RELOCALIZING state, and a pre-existing large Sharp image test timing out at its 5 s default under parallel load. The assertions now expect explicit LOST, and that one OCR test has a 15 s bound; the final full suite passed.

- **UNIT PASS:** pure route-summary, familiarity, GPS quality and existing guidance/localization/vision checks.
- **INTEGRATION PASS (mocked):** owner-scoped saved-route API and current-building POST contract. No live MySQL was available.
- **SIMULATED PASS:** university route, familiarity, corridor closure, detour and reopening, plus existing B1–B6 simulated scenarios.
- **BROWSER PASS (mocked services/simulated GPS):** keyboard Start, accessible-name controls, indoor map, saved-place and saved-route flows, confirmed arrival, outdoor GPS quality and straight-line disclaimer; 0 axe WCAG A/AA violations on each of the indoor and outdoor fixtures.
- **DEVICE NOT TESTED:** physical GPS, camera/OCR, motion, NFC, haptics and speech playback.
- **FIELD NOT TESTED:** real venue, blind-user study or route safety.

## W. Simulated scenario results

The new scenario models a university gate GPS fix, indoor entrance, elevator to floor two, corridor and exam room. Day 1's successful graph route is summarized; day 2 discovers the familiar template and freshly plans it. When the usual corridor is marked closed, the familiar prior is rejected and a detour is chosen. On reopening, it becomes eligible again. A second simulation demonstrates that a slightly longer familiar route can win over a shorter novel route, while a new high-risk edge removes that advantage. Browser fixtures exercise a subset with mocked map/API and GPS.

## X. Additional test coverage

New tests cover compactness, floor-transition and connectivity validation, route ownership, raw-track rejection, familiarity, closure/expiry/risk behavior, GPS quality and age, private place save, keyboard activation, confirmed arrival and route save. Existing localization/guidance/vision/Shared Map tests run in the full suite. No real sensor, real voice playback or live MySQL migration was exercised here.

## Y. Known limitations

1. The outdoor view shows a bearing and straight-line distance, not a pedestrian polyline, ETA, off-route detection or outdoor rerouting. It must not be used as crossing guidance.
2. Indoor routing and journey memory currently cover one building graph. A gate-to-room journey spanning outdoor streets and multiple buildings cannot be retained as one replayable route.
3. GPS proximity uses the building coordinate, which may be its center; a QR/manual/known anchor is still needed for indoor localization.
4. Private routes are unavailable after reloading offline unless already held in the current page state. Public map cache can be stale, especially for hazards.
5. Server-side success is a user report. Route confidence is heuristic. Last verified date remains unset until a real map-verification process supplies it.
6. Temporary vision hazards are local session constraints; no new server-side TTL hazard feed was added.
7. A full WCAG 2.2 AA audit, real screen reader and multilingual review of the new UI remain.

These limits mean several requested acceptance criteria remain open; this PR is an incremental, reviewable implementation, not a field-ready guarantee.

## Z. Required real-world field tests

Test with consenting blind participants and mobility specialists in a university, school, airport, hospital, mall, government office, railway station and conference venue. Measure GPS error at entrances; verify QR/NFC placement and floor transition reliability; test elevator outages, corridor closures, crowding, doors and room OCR; assess audio/haptic cognitive load, keyboard/screen-reader behavior, Arabic/English/Chinese phrasing, offline recovery, deletion, and false-arrival/off-route rates. Run a separate live MySQL migration rehearsal and cross-account privacy test.

## AA. Changed files

28 files:

- `client/src/components/navigation/NavigationRouteMap.tsx`
- `client/src/components/navigation/OutdoorApproach.tsx`
- `client/src/lib/guidance/engine.ts`
- `client/src/lib/guidance/guidance.test.ts`
- `client/src/lib/guidance/journey.test.ts`
- `client/src/lib/guidance/journey.ts`
- `client/src/lib/guidance/outdoor.ts`
- `client/src/lib/guidance/route.ts`
- `client/src/lib/guidance/voice.ts`
- `client/src/lib/navigationApi.ts`
- `client/src/lib/navigationCache.ts`
- `client/src/pages/Guidance.tsx`
- `client/src/pages/Navigation.tsx`
- `docs/navigation-map-v2-audit.md`
- `docs/navigation-map-v2-report.md`
- `scripts/navigation-browser-e2e.ts`
- `server/b6.simulatedE2E.test.ts`
- `server/migrations/0009_saved_routes.sql`
- `server/migrations.ts`
- `server/navigation.b4.test.ts`
- `server/navigation.ts`
- `server/ocr.test.ts`
- `server/savedRouteDomain.ts`
- `server/savedRoutes.api.test.ts`
- `server/savedRoutes.test.ts`
- `server/savedRoutes.ts`
- `shared/guidance.ts`
- `shared/navigation.ts`

## AB. Final commit SHA

Recorded in the delivery message and PR head after commit (a commit cannot contain its own SHA).

## AC. PR URL

Recorded in the delivery message after PR creation.

## AD. Main branch

All changes are on `codex/accessibility-navigation-map-v2`, created from `origin/main` at the SHA above. No checkout or commit to local `main` was made.

## AE. Merge

No merge was performed.

## AF. Force push

No force push was performed.

## 10 أفكار للجيل القادم من خارطة بصيرة

1. **جامعة:** ربط بوابات الحرم بمسارات المشي المعتمدة وتوقيت فتحها، مع نقطة تثبيت عند كل مبنى.
2. **مدرسة:** نمط رحلة بإشراف اختياري بين المدخل والصف من دون مشاركة سجل الطفل الخام.
3. **مطار:** مزامنة تغيّر البوابة والمصعد ومكان التفتيش مع بيانات تشغيلية رسمية.
4. **مستشفى:** ربط موعد العيادة بمدخل صحيح، مصعد عامل ونقطة استقبال بشرية مؤكدة.
5. **مول:** اكتشاف الأكشاك المؤقتة والعوائق الموسمية بمساهمات منقّحة قصيرة العمر.
6. **وزارة:** توجيه إلى شباك الخدمة الفعلي وفق رقم الدور من دون كشف سبب الزيارة.
7. **محطة قطار:** مواءمة الرصيف والباب والمصعد مع بيانات المشغّل وتنبيهات تغيّر الرصيف.
8. **مؤتمر:** خريطة مؤقتة مع نسخ زمنية لقاعات تتغير وأماكن استقبال متطوعين.
9. **كل المواقع:** معايرة شخصية اختيارية لطول الخطوة وإيقاع التعليمات والاهتزاز عبر تجارب قصيرة بموافقة صريحة.
10. **كل المواقع:** طبقة تحقق من جودة المعالم تُقارن تعليمات الخريطة بنتائج الوصول الفعلية المجهولة قبل ترقية أي معلومة عامة.

## Follow-up — geographic map and final exam delivery (6 October 2026)

This follow-up supersedes the outdoor-routing limitation described above for the current branch. The prior UI had an indoor SVG graph and a straight-line GPS sketch; it had no geographic basemap or pedestrian route. The current UI uses MapLibre GL JS with the verified OpenFreeMap Liberty vector style, with OpenStreetMap attribution, and the FOSSGIS `routed-foot` OSRM service for an on-demand walking polyline. Forge Maps was audited in the repository: `client/src/components/Map.tsx` was an unused Google Maps proxy example, while no `VITE_FRONTEND_FORGE_API_KEY` or map runtime setting exists in the working environment. It was therefore not treated as an available production map service and no paid provider was introduced.

`/navigation` now presents a large geographic map before a destination is selected. It supports pan, zoom, recenter, mobile sizing, map clicks, destination fit, a GPS marker, reported accuracy ring, heading arrow, HIGH/MEDIUM/LOW/LOST quality, permission-denied messaging, a pedestrian route with completed/remaining sections, and a full-screen toggle. GPS fixes are filtered for impossible jumps and throttled; the route request sends only the current origin and destination and is never made per fix. `/navigation/guidance` presents the same outdoor map and switches explicitly to the existing indoor floor graph after a trusted anchor. The indoor renderer now includes a grid, zones/hazards, corridors, rooms/doors, entrances/exits, stairs, elevators, destination, uncertainty and route state.

The new browser fixture `scripts/geographic-map-browser-e2e.ts` records three separate gates: `MAP RENDER PASS` (vector tiles and nonblank canvas), `MOCK GPS PASS` (A→B→C→D plus destination E and route polyline), and `BROWSER PASS` (mobile map, full-screen map, `/navigation`, and outdoor/indoor guidance modes). It is simulated browser validation, not real walking or field safety validation. OpenFreeMap is a free public service with no API key; FOSSGIS routing allows at most one request per second and logs route requests, so production capacity and privacy terms must be reviewed before scale-up.

The exam export flow now requires final approval, creates an owner-scoped immutable final PDF submission, and opens a recipient review step. A student can add up to five recipients with individual name, email, course and optional organization, validate every address, optionally save contacts with consent, review the list, and explicitly confirm sending. Server routes in `server/examSubmissions.ts` use existing SMTP credentials, a per-operation idempotency key, explicit resend for a prior failure, owner checks, sanitized per-recipient status and failure codes, rate limiting, and a stored final PDF that remains available after SMTP failure. Subjects contain only `تسليم اختبار عبر منصة بصيرة – [المقرر]`; exam content is sent as a PDF attachment and is never placed in the subject. The legacy direct-send endpoint returns `410` so drafts cannot bypass approval.

Validation for this follow-up: `pnpm check` PASS; `pnpm test` PASS with 32 files and 228 tests; `pnpm build` PASS; `git diff --check` PASS; `pnpm exec vitest run server/examSubmissions.test.ts` PASS with six approval, validation, owner, idempotency, failure and explicit-resend tests; browser map fixture PASS. A deployed URL was not available in this run, so deployment acceptance remains to be checked against the actual deployment after this branch is deployed.

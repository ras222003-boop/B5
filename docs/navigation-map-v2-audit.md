# Basira Accessible Navigation Map — audit and design record

## Baseline audit (before changes)

The current product is a substantial **indoor** navigation system. `Navigation.tsx` searches buildings and private saved places; `Guidance.tsx` prepares a destination, accepts manual/QR/visual anchors, tracks pedestrian motion, speaks instructions, vibrates, recognizes places, and reacts to vision hazards. `Mapping.tsx` records mapper sessions and suggestions. `NavigationAdmin.tsx` edits nodes, edges and zones. `IndoorManager.tsx` handles organization ownership, imports and versions. `SharedMap.tsx` submits and moderates public contributions and issue reports. `navigationApi.ts` wraps the existing APIs.

`shared/navigation.ts` defines the graph and saved places; `shared/localization.ts` defines confidence-bearing estimates and observations. `client/src/lib/localization` weights QR/NFC/manual/vision/motion differently, decays confidence and handles floor transitions. `client/src/lib/guidance` already supplies Dijkstra routing, risk and accessibility cost, persistent off-route detection, rerouting, conservative arrival evidence, landmark instructions, speech priority and haptics. `client/src/lib/vision` supplies camera detection, OCR, place recognition and hazard fusion. `server/navigation.ts` has authorized private saved-place CRUD and public graph reads. `server/localization.ts` is for mapper sessions. `server/sharedMap.ts`, `sharedMapDomain.ts`, and `sharedMapPromotion.ts` provide consent, corroboration, moderation, versioning and rollback. Migrations 0003–0008 are additive at startup.

Works in code and tests: indoor route planning, temporary edge avoidance, QR/manual anchoring, confidence decay, private place ownership, map version synchronization and reviewed public contributions. Field accuracy and browser sensor availability are unverified.

Reusable: graph, saved places, localization estimates, route and safety engines, speech engine, camera/OCR, map-version flow, moderation. No replacement graph, localization stack or public-contribution pipeline is warranted.

Gaps: no saved **route** model or replay/learning; no return-to-start control; no route drawing in guidance; no continuous outdoor GPS guidance or robust outdoor-to-indoor handoff; offline graph cache lasts only the browser session; no route-specific hazard TTL feed; saved outdoor points cannot be guided to by the indoor engine. The mapping track is durable for authorized mapping sessions, while ordinary navigation has no durable raw track. The `Navigation` page gets one GPS fix but does not display its accuracy. UI and state-machine labels are primarily indoor. Do not equate a direct GPS bearing with a pedestrian path.

## Independent invention round, before implementation

| # | Idea | Priority | Rationale / disposition |
|---|---|---|---|
| 1 | Private journey template with only graph IDs, turns and anchors | MUST HAVE | Learn without retaining raw position history; implement. |
| 2 | Familiarity discount only after current closure and risk checks | MUST HAVE | Prior experience must never override current evidence; implement. |
| 3 | Route freshness label tied to map version and last verified use | MUST HAVE | Reduce false confidence; implement. |
| 4 | Explicit saved-route naming after confirmed arrival | MUST HAVE | Informed opt-in; implement. |
| 5 | Return-to-start from current reliable fix | MUST HAVE | Useful recovery; implement. |
| 6 | Floor-specific map drawing with current fix and uncertainty | MUST HAVE | Clear visual context; implement. |
| 7 | Persistent off-route evidence threshold | MUST HAVE | Suppress GPS/motion jitter; reuse and refine. |
| 8 | One-tap repeat and position answer | MUST HAVE | Lower cognitive demand; reuse. |
| 9 | Route mismatch warning before replay | HIGH VALUE | Avoid stale template instructions; implement. |
| 10 | Endpoint proximity *and* independent arrival evidence | HIGH VALUE | Prevent premature arrival; reuse. |
| 11 | Explicit unknown-location mode and anchor recovery | HIGH VALUE | Stop precise instructions when lost; reuse. |
| 12 | Local recent building cache with freshness disclosure | HIGH VALUE | Partial offline operation; improve. |
| 13 | Route edge signature for similarity without raw traces | HIGH VALUE | Find familiar destination quickly; implement. |
| 14 | Landmark wording only for mapped, verified places | HIGH VALUE | Reduce ambiguity; refine. |
| 15 | GPS quality ladder based on reported accuracy and age | HIGH VALUE | Make uncertainty visible; implement where GPS is used. |
| 16 | Entrance confirmation before switching to indoor coordinates | HIGH VALUE | GPS alone cannot establish indoor floor; implement. |
| 17 | Haptic mute setting | HIGH VALUE | Respect sensory preference; implement. |
| 18 | Hazard expiry and provenance for transient reports | HIGH VALUE | Avoid permanent temporary blocks; existing transient constraints; refine. |
| 19 | Shared-route suggestion as a separate reviewed action | EXPERIMENTAL | Requires careful consent and anonymous geometry; defer. |
| 20 | Indoor barometer calibration at known elevator | EXPERIMENTAL | Sensor/browser support and building validation needed; defer. |
| 21 | Scene-guided door-side cue | EXPERIMENTAL | Needs field validation of OCR and door detection; defer. |
| 22 | Outdoor pedestrian network import from trusted map data | FUTURE | Needed for real walking route; defer. |
| 23 | Crowdsourced accessible crossing reliability | FUTURE | Needs governance and field evidence; defer. |
| 24 | Haptic-only silent instruction mode | FUTURE | Must be user tested; defer. |

Decision: extend the authenticated graph/saved-place stack with private journey memory and a conservative UI. Keep outdoor bearing distinct from a verified walking route. Never automatically publish personal routes.

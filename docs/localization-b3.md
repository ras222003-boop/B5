# B3 — Localization & Auto Mapping

## What works

- A mapper or admin opens **مسح المبنى** from the B1 map editor, selects a building, starts an explicit mapping session, anchors at a known B1 node, and walks with motion and heading sensors when available.
- A nearby B1 building can be suggested using coarse geolocation only when the browser reports accuracy of at most 75 m and the nearest building is within 70 m. GPS never supplies an indoor room or local map coordinate.
- Manual B1 node or place, a mapper-confirmed local floor origin, QR, optional Web NFC, and B2 recognized place signs can correct the local estimate. QR contains only building, floor, and node IDs and must match the loaded B1 graph.
- B2 segmentation can support a cautious corridor proposal when a continuous motion track spans at least 3 m and the observed path ahead is clear. It cannot measure corridor width or guarantee safety.
- The screen displays confidence, uncertainty radius, last strong anchor, expected floor, scan counts, a sighted track sketch, and short live announcements. When confidence is lost, dead reckoning stops until a new anchor is applied.
- Mapping mode stores the corrected local-coordinate track, anchor observations, floor events, and reviewable suggestions. Normal localization never stores a continuous track. A cancelled session deletes its uploads.
- A private SavedPlace can keep the current local coordinate and confidence for the signed-in owner. It is not made public.
- In the ordinary B2 vision screen, recognition of a known place can create a temporary B3 visual anchor and offer a private SavedPlace. This mode keeps no trajectory or mapping session.

## Confidence model

QR ≤ 0.97, NFC ≤ 0.95, manual ≤ 0.90, recognized visual place ≤ 0.85. Motion alone cannot create the first indoor position. GPS can identify a building but is capped at 0.25 and cannot set `x`, `y`, or `floorId`. Confidence halves every 60 seconds without a new observation, uncertainty grows over time and by 0.18 m per estimated step, and tracking becomes lost below 0.30 or after 180 seconds without a strong anchor. Compass jumps over 60° in less than 750 ms are downgraded. These are conservative model parameters, **not measured localization accuracy**.

Floor transitions clear the floor and mark localization lost. A known B1 node, QR, NFC, or recognized place with coordinates can confirm the next floor. Barometer, native altitude, BLE beacons, Wi-Fi RTT, and native AR remain typed extension points; web B3 does not fabricate readings from them. Web NFC, device motion, and camera availability vary by browser and secure context. Optional step calibration accepts a known distance and step count with a 0.30–1.20 m per-step bound.

## Mapping lifecycle

`POST /api/navigation/mapping-sessions` starts a session. The browser uploads track batches to `/:sessionId/track`, strong anchors to `/:sessionId/anchors`, floor transitions to `/:sessionId/floor-events`, and suggestions to `/:sessionId/suggestions`. `POST /:sessionId/finalize` closes or cancels it. `GET /:sessionId` and `GET /buildings/:id/mapping-sessions` retrieve owned sessions. `GET /buildings/:id/anchors` exposes public B1 anchors. `GET /buildings/:id/map-suggestions` lists review items. `POST /map-suggestions/:id/review` accepts or rejects one item in a database transaction.

The client deduplicates suggestions by floor, type, normalized name, place ID, and approximate position. A repeated known anchor performs loop closure: endpoint drift is distributed over the track since the previous visit, with corresponding suggestion coordinates adjusted. On approval, a node or corridor is inserted into the existing B1 graph, reusing nearby nodes and checking for existing edges; a newly recognized place becomes public only after explicit approval. A rejected or pending suggestion changes no B1 map data. The reviewer must confirm geometry and accessibility before relying on a route; B3 does not provide routing or turn-by-turn guidance.

## Deployment and validation

`0004_localization.sql` adds additive mapping tables. `ensureSchema()` also adds optional private local-coordinate columns to existing saved places. The migration runs at app startup and requires the same MySQL service as B1. Run `pnpm check`, `pnpm test`, and `pnpm build` before deployment. There has been no field calibration or measured positioning error; the displayed uncertainty is a model estimate.

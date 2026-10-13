Live perception could retain stale detections, assign unstable spatial-bin identities, and announce approach from bounding-box growth alone. This change ties observations and speech to capture freshness, moves EfficientDet inference into a Worker, and adds conservative tracking, experimental ground/motion evidence, an accessible directional radar, and local Arabic visual questions.

This draft is stacked on PR #36 (`codex/basira-voice-vision-ai-description`, base `c52b755`). It preserves the existing authenticated, consent-based, quota-limited Forge description route. No deployment, merge, or production database writes were performed.

## Behavior

- Expand existing COCO label mapping, validate geometry, and apply class-aware NMS; no new trained weights or invented classes.
- Clear current perception on stale, frozen, paused, or stopped input; reject results completing after pause. Independently expire semantic and approach evidence and queued speech.
- Associate identities over time and require compensated pixel motion plus stable box expansion for optional experimental approach cues. No metric distance or collision probability is inferred.
- Add uncertain lower-image/ground observations and an accessible radar/list with independent speech and alert controls. Direct questions use fresh local evidence; detailed questions retain the existing Forge safeguards.
- Gate research-only SegFormer weights behind an explicit opt-in, off by default. Add reproducible metrics, isolated preview, research, audit, and acceptance-state documentation.

## Validation

- 455 Vitest cases in 82 files passed; TypeScript and client/server builds passed.
- 13 perception-metrics and 4 existing auto-meter report tests passed; metric model integrity verification passed.
- Two desktop Chrome scenarios passed using the real local model/Worker on a canvas stream of one chair photo. Local answers, radar controls, pause/stop cleanup, consent rejection, and screen-reader-mode TTS suppression verified; zero cloud uploads, page errors, or axe violations in the new panel. Speech playback was stubbed, not audibly assessed.
- Paired 20-sample desktop benchmark: main-thread timer gap 187.9 → 45.4 ms; detection median 124.3 → 126.7 ms and p95 172.5 → 155.6 ms. This is one image/run, not mobile or accuracy validation.

## Acceptance limitations

E2–E7 remain open for field acceptance. Only the chair image was tested with real detection; label mappings and synthetic ground/motion cases do not establish per-class accuracy. No phone/physical-camera, real screen-reader, audible Arabic, annotated field accuracy, battery/thermal, or live Forge validation was available. Ground and approach cues remain experimental. Existing large-bundle warnings remain. See [implementation and acceptance report](basira-perception-status.md), [research](basira-e1-research.md), [baseline audit](basira-e1-audit.md), and [field protocol](basira-field-evaluation.md).

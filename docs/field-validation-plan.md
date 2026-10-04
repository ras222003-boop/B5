# B6 controlled field validation plan

**Status:** planned only. No test in a real KKU building, with a blind participant, or on a phone has been run by this repository task. Automated results are simulated and do not establish navigation safety.

## Gates and participants

1. **Sighted developer, controlled course:** verify every graph node and edge against a measured floor plan; walk routes with a spotter; record localization, false alerts, emergency stop, camera/microphone shutdown, battery, and heat. No independent use.
2. **Building staff/researchers in a known building:** obtain site permission and a verified official map; test different floors, closures, crowded periods, network loss, and device models. A safety observer accompanies each run.
3. **Supervised participants from the intended user group:** accessibility researcher and orientation/mobility specialist prepare consent and stopping rules. Participants can stop at any time, use their usual mobility aids, and are accompanied by a trained observer. Do not treat the software as a replacement for a cane, guide dog, or mobility training.

Progress only after written review of the prior phase's hazards and failures. Suspend a trial when localization is uncertain, a route differs from the verified map, an obstacle warning is missed, or a participant requests it. Record incidents without storing camera streams or unnecessary precise tracks.

## KKU example (planning scenario)

**King Khalid University — Faculty of Education, Room 121** is a proposed validation scenario, not a claim that we possess its real floor plan. Obtain the approved floor plan and institutional permission first. Example sequence: entrance → known QR/anchor → corridor → intersection → verified floor transition if needed → Room 121 sign → confirmed arrival. Measure both normal and temporarily closed routes. Do not label the hypothetical test graph as the actual building.

## Metrics to measure, not invented results

| Metric | Method |
| --- | --- |
| Localization error (m) | Compare estimates with surveyed reference points per floor and device. |
| Route completion and wrong turns | Count successful destinations and deviations per trial. |
| Relocalization frequency and recovery time | Log transitions to uncertain state and time to confirmed anchor. |
| Obstacle alert recall and false alert rate | Annotate controlled obstacles; separate uncertain drop-offs and stairs. |
| OCR room-sign accuracy | Compare room label output with verified signs across lighting conditions. |
| Route recomputation and instruction latency | Timestamp closure/obstacle event and next valid instruction. |
| Destination recognition success | Require verified node proximity plus independent sign/anchor evidence. |
| Crash rate, battery use, thermal impact | Record device model, browser, duration, battery and temperature. |

Report numerator/denominator, confidence intervals where appropriate, device/browser details, and all misses. Privacy review must precede any collection. No field values have been measured yet.

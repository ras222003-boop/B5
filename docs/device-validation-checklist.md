# Device validation checklist

**Status:** ready for a supervised field session; no physical device result is
claimed by the Validation Gate.

Use one row per device and browser. A sighted observer and the participant's
usual mobility aid must be present. Stop immediately when localization is
uncertain, an obstacle is missed, the route differs from the reviewed map, or
the participant asks to stop.

## Android — Chrome

| Check | Pass | Fail | Not tested | Evidence / notes |
| --- | --- | --- | --- | --- |
| Camera permission and preview | ☐ | ☐ | ☒ | |
| Motion permission and mapping cleanup | ☐ | ☐ | ☒ | |
| TTS language and interruption | ☐ | ☐ | ☒ | |
| STT capability and fallback | ☐ | ☐ | ☒ | |
| Vibration / haptic fallback | ☐ | ☐ | ☒ | |
| WASM and model load time | ☐ | ☐ | ☒ | |
| Battery drain for a fixed route | ☐ | ☐ | ☒ | |
| Thermal state after repeated runs | ☐ | ☐ | ☒ | |

## iPhone — Safari

| Check | Pass | Fail | Not tested | Evidence / notes |
| --- | --- | --- | --- | --- |
| Camera permission and preview | ☐ | ☐ | ☒ | |
| Motion permission and relocalization | ☐ | ☐ | ☒ | |
| TTS language and interruption | ☐ | ☐ | ☒ | |
| STT capability and fallback | ☐ | ☐ | ☒ | |
| Vibration limitation documented | ☐ | ☐ | ☒ | |
| WASM and model load time | ☐ | ☐ | ☒ | |
| Battery drain for a fixed route | ☐ | ☐ | ☒ | |
| Thermal state after repeated runs | ☐ | ☐ | ☒ | |

Record device model, OS version, browser version, network state, map version,
route, start/end battery, and every warning. Do not store camera video or
unnecessary precise movement traces.

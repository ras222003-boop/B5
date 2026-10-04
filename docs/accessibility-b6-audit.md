# B6 navigation accessibility review

This is a source-level audit of navigation screens, not a certified WCAG assessment. No browser with VoiceOver, TalkBack, JAWS or NVDA was exercised in this task.

## Changes made

- Removed `maximum-scale=1` from the document viewport so browser zoom and text scaling are not artificially blocked.
- The organization manager, permission center and capability screen use headings, associated form labels, visible status text and large controls. Import errors and warnings are presented in the page rather than only in a console or raw JSON. The emergency stop has an explicit accessible name.
- The permission center gives reason, optionality, status and fallback for Camera, Microphone, Location, Motion, Bluetooth, NFC and Notifications, in Arabic, English and Chinese. It does not trigger permission prompts on page load.
- Localization loss cancels queued turn speech before announcing the uncertain location; the route UI shows a relocalization alert. Emergency stop cancels session media and vibration.
- The prior absolute WCAG conformance and “100% independence” claims were replaced with language describing an ongoing audit.

## Remaining browser audit before supervised trials

1. Keyboard only: tab order, focus visibility, dropdown/textarea operation and focus restoration after import preview, approval, rejection, route changes and dialogs.
2. Screen readers on Windows/iOS/Android: verify headings, landmarks, route instruction priority, status announcements and nonduplicate speech when the app's TTS and a screen reader run together.
3. Arabic RTL, English LTR and Chinese: verify label pronunciation, mixed numeric room signs, direction wording and layout at 200% and 400% zoom.
4. Contrast and target size: measure all navigation states, disabled controls, alerts, and maps against WCAG criteria with actual rendered styles.
5. Touch exploration while camera is active; ensure the emergency stop is reachable and understandable.

Do not claim WCAG 2.1 AA conformance until these checks and remediations are complete.

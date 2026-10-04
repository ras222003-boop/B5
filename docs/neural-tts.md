# Basira neural speech engine

## Architecture

All app speech uses `AudioPlaybackManager` through `useTextToSpeech` or `VoiceNavigationService`. The browser requests `/api/speech/synthesize`; the backend validates text, context, locale, rate and voice, then routes to a configured provider. The player queues full phrases, enforces navigation and safety priorities, cancels a lower priority sound on an urgent announcement, and falls back to Web Speech when the premium request or playback fails. No cloud credential is sent to React. Speech recognition (STT) and OCR are separate.

`GET /api/speech/voices` returns curated voices and a configured/unconfigured flag. `POST /api/speech/synthesize` accepts `{text,language,arabicStyle,voiceId,context,rate}` and returns MP3 audio. Contexts: `NAVIGATION`, `SAFETY`, `EXAM`, `QUESTION`, `ANSWER_OPTION`, `ENVIRONMENT`, `GENERAL`. Premium synthesis requires a valid Better Auth session. An anonymous user receives `401`, disabled or unavailable Premium returns `503`, and a quota or capacity rejection returns `429`; all yield browser speech fallback in the playback manager. It never substitutes an MSA provider for the Saudi selection. Every speech API response uses `Cache-Control: no-store`.

## Access, cost limits and privacy

Premium voice: text is transmitted to the selected cloud speech provider for synthesis. This includes exam questions, educational text and private navigation phrases when the user requests Premium speech. Local/browser fallback: text remains with the browser/device speech implementation, subject to browser and operating system behavior. Screen reader mode suppresses both Basira Premium and Basira browser speech. The user can still use their own screen reader.

`PREMIUM_TTS_ENABLED=true` and the selected provider's `GOOGLE_TTS_ENABLED=true` or `AZURE_TTS_ENABLED=true` must be set explicitly, in addition to provider credentials. All switches default to off. With Premium off, the backend returns `premium_voice_disabled` and `fallback: browser`; it never calls the provider. Default limits are 12 requests per user per minute, 8,000 Unicode characters per user per minute, 50,000 characters per user per UTC day, 250,000 characters across all users per instance per UTC day, 40 requests per IP per minute and 4 in-flight syntheses. Configure them with `TTS_USER_REQUESTS_PER_MINUTE`, `TTS_USER_CHARACTERS_PER_MINUTE`, `TTS_USER_CHARACTERS_PER_DAY`, `TTS_GLOBAL_CHARACTERS_PER_DAY`, `TTS_IP_REQUESTS_PER_MINUTE`, and `TTS_MAX_CONCURRENT`. Hard ceilings clamp these values to 60, 20,000, 200,000, 1,000,000, 120 and 8 respectively. A provider request times out after 15 seconds; audio above 8 MB is rejected. Rejections do not call a provider.

These counters are **per server process** and reset on restart. Use a single instance for the live listening stage. Before enabling Premium on multiple instances, add a shared atomic quota store and an account-level provider billing budget; process-local quotas cannot enforce a deployment-wide spending cap. The default-off switch is the safe configuration until that protection exists.

The speech endpoint does not write exam text to the database, logs, analytics or metrics, and it does not cache exam audio persistently. In-memory counters hold user IDs, IPs and numbers only; in-memory client metrics hold timings and counts only. Development debug capture redacts speech bodies and skips exam/navigation UI event capture. Provider errors are reduced to fixed response codes without sensitive text. Avoid logging HTTP request bodies in hosting infrastructure.

## Arabic MSA vs Saudi Arabic

`MSA` is an app preference routed to Google's generic Arabic `ar-XA` Chirp 3 HD voice. `SAUDI` routes to Azure's documented `ar-SA` neural voices. The locale is a provider identifier; the app keeps its own `MSA`/`SAUDI` enum. The Saudi provider offers two documented curated voices at present: `ar-SA-ZariyahNeural` (female) and `ar-SA-HamedNeural` (male). We do not claim four Saudi choices. MSA, English and Chinese each offer two female and two male curated Chirp voices. Availability still depends on the configured cloud account and region and must be checked live.

A **voice accent** changes how the same text is pronounced. **Conversational wording** changes the words themselves. Navigation instructions and selected Basira-generated guidance messages use fixed local phrase catalogs, including concise Saudi wording such as “خذ يمين” and “بحسب لك مسار جديد”. Safety uses a separate conservative catalog and keeps uncertainty explicit. Academic question text, options, teacher uploads, OCR text and user documents are never rewritten into a dialect. The normalizer only pronounces room digits separately and distance quantities in Basira-generated navigation and safety contexts; it leaves exam and general source text unchanged. Mixed-language phrases remain in one request; provider pronunciation of embedded foreign words needs listening validation.

## Providers and configuration

Google: enable Cloud Text-to-Speech, billing and a server-side service account with permission to synthesize. Set Application Default Credentials using `GOOGLE_APPLICATION_CREDENTIALS` and set `GOOGLE_CLOUD_PROJECT`. The backend uses `google-auth-library` to obtain an OAuth token and calls the Cloud TTS REST `text:synthesize` endpoint using `MP3`, `speakingRate` and a curated Chirp 3 HD voice. Verify account, regional availability, quota and prices before deployment. No Google API key is placed in the client.

Azure Saudi: create an Azure Speech resource in a supported region; set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` on the server. The backend calls that region's `cognitiveservices/v1` endpoint with SSML and `audio-24khz-96kbitrate-mono-mp3`. Confirm both `ar-SA` voices in the actual resource/region before calling them live. No Azure key is placed in the client.

Voice catalog sources: [Google Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [Google supported voices](https://cloud.google.com/text-to-speech/docs/voices), [Azure language and voice support](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts), [Azure TTS REST API](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech).

## Playback, latency and safety

Navigation announces one phrase per request and prefetches the next instruction when a route is known. A changed route invalidates old prefetches. Prefetch is best effort; no streaming transport is implemented. The player measures request to complete audio arrival (`firstAudioMs`), synthesis wait (`synthesisMs`), playback start (`playbackStartMs`) and fallback count in memory without text. Because synthesis returns a complete MP3, “first audio” is the completed response arrival, not a streaming first byte. These measurements should be sampled in field testing; arrays are session-local.

Priority order: critical safety, high safety, relocalization, turn, arrival, information. A higher priority item interrupts a lower one. Screen reader mode suppresses Basira speech, and offline or provider failure uses browser TTS with a visible status. Browser TTS quality still varies by device. If no browser voice exists, visual instructions and controls remain available.

## Validation

Run `pnpm check`, `pnpm test`, `pnpm build`, `git diff --check`, and `pnpm exec tsx scripts/voice-browser-e2e.ts` with Vite running on port 4173 (or set `VOICE_BASE_URL`). Unit and browser tests use mocked audio/provider responses. They verify contracts, routing, exact Saudi exam question text, preferences, preview, fallback and key navigation controls. They do **not** establish human perceived clarity or naturalness. After credentials are configured, sign in and open `/settings/voice-validation` to listen to every curated voice's Preview, Navigation, Safety, Room, Distance and Exam samples. Record results in [voice-quality-validation.md](voice-quality-validation.md). **Google: NOT LIVE VALIDATED. Azure: NOT LIVE VALIDATED.**

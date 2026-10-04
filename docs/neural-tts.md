# Basira neural speech engine

## Architecture

All app speech uses `AudioPlaybackManager` through `useTextToSpeech` or `VoiceNavigationService`. The browser requests `/api/speech/synthesize`; the backend validates text, context, locale, rate and voice, then routes to a configured provider. The player queues full phrases, enforces navigation and safety priorities, cancels a lower priority sound on an urgent announcement, and falls back to Web Speech when the premium request or playback fails. No cloud credential is sent to React. Speech recognition (STT) and OCR are separate.

`GET /api/speech/voices` returns curated voices and a configured/unconfigured flag. `POST /api/speech/synthesize` accepts `{text,language,arabicStyle,voiceId,context,rate}` and returns MP3 audio. Contexts: `NAVIGATION`, `SAFETY`, `EXAM`, `QUESTION`, `ANSWER_OPTION`, `ENVIRONMENT`, `GENERAL`. The backend returns `503` if the selected provider is not configured; the client then uses the local browser voice. It never substitutes an MSA provider for the Saudi selection. The server does not log synthesis text, provider responses or credentials. Development debug capture redacts speech bodies and skips private exam/navigation UI replay.

## Arabic MSA vs Saudi Arabic

`MSA` is an app preference routed to Google's generic Arabic `ar-XA` Chirp 3 HD voice. `SAUDI` routes to Azure's documented `ar-SA` neural voices. The locale is a provider identifier; the app keeps its own `MSA`/`SAUDI` enum. The Saudi provider offers two documented curated voices at present: `ar-SA-ZariyahNeural` (female) and `ar-SA-HamedNeural` (male). We do not claim four Saudi choices. MSA, English and Chinese each offer two female and two male curated Chirp voices. Availability still depends on the configured cloud account and region and must be checked live.

A **voice accent** changes how the same text is pronounced. **Conversational wording** changes the words themselves. Navigation instructions use fixed local phrase catalogs, including concise Saudi wording such as “خذ يمين”. Safety uses a separate conservative catalog and keeps uncertainty explicit. Academic question text, options, teacher uploads, OCR text and user documents are never rewritten into a dialect. The normalizer only pronounces room digits separately and distance quantities in Basira-generated navigation and safety contexts; it leaves exam and general source text unchanged. Mixed-language phrases remain in one request; provider pronunciation of embedded foreign words needs listening validation.

## Providers and configuration

Google: enable Cloud Text-to-Speech, billing and a server-side service account with permission to synthesize. Set Application Default Credentials using `GOOGLE_APPLICATION_CREDENTIALS` and set `GOOGLE_CLOUD_PROJECT`. The backend uses `google-auth-library` to obtain an OAuth token and calls the Cloud TTS REST `text:synthesize` endpoint using `MP3`, `speakingRate` and a curated Chirp 3 HD voice. Verify account, regional availability, quota and prices before deployment. No Google API key is placed in the client.

Azure Saudi: create an Azure Speech resource in a supported region; set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` on the server. The backend calls that region's `cognitiveservices/v1` endpoint with SSML and `audio-24khz-96kbitrate-mono-mp3`. Confirm both `ar-SA` voices in the actual resource/region before calling them live. No Azure key is placed in the client.

Voice catalog sources: [Google Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [Google supported voices](https://cloud.google.com/text-to-speech/docs/voices), [Azure language and voice support](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts), [Azure TTS REST API](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech).

## Playback, latency and safety

Navigation announces one phrase per request and prefetches the next instruction when a route is known. A changed route invalidates old prefetches. Prefetch is best effort; no streaming transport is implemented. The player measures request to complete audio arrival (`firstAudioMs`), synthesis wait (`synthesisMs`), playback start (`playbackStartMs`) and fallback count in memory without text. Because synthesis returns a complete MP3, “first audio” is the completed response arrival, not a streaming first byte. These measurements should be sampled in field testing; arrays are session-local.

Priority order: critical safety, high safety, relocalization, turn, arrival, information. A higher priority item interrupts a lower one. Screen reader mode suppresses Basira speech, and offline or provider failure uses browser TTS with a visible status. Browser TTS quality still varies by device. If no browser voice exists, visual instructions and controls remain available.

## Validation

Run `pnpm check`, `pnpm test`, `pnpm build`, `git diff --check`, and `pnpm exec tsx scripts/voice-browser-e2e.ts` with Vite running on port 4173 (or set `VOICE_BASE_URL`). Unit and browser tests use mocked audio/provider responses. They verify contracts, routing, exact Saudi exam question text, preferences, preview, fallback and key navigation controls. They do **not** establish human perceived clarity or naturalness. Complete [voice-quality-validation.md](voice-quality-validation.md) with real Google/Azure credentials, devices and listeners before claiming voice quality.

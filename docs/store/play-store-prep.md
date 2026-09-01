# Play Store prep (#7) — everything agent-doable, done; two user-only steps

## User-only steps (blocking)
1. **Create the Play developer account** — $25 one-time, play.google.com/console/signup.
   Identity verification takes days and runs in parallel with everything else.
2. **Content rating questionnaire** — must be answered by the account holder.

## Data Safety form — answers (D-17 makes this nearly trivial; one judgment call)
- Accounts, analytics, crash reporting, ads: none. Photos and all plant data
  never leave the device.
- **The one judgment call — the weather lookup:** the app sends the user-typed
  ZIP to Open-Meteo (no identifiers, nothing stored, response used and
  discarded). Play's policy exempts "ephemeral processing" from the *collected*
  definition, which this fits — but the conservative, defensible answer is to
  declare **"Approximate location — collected, not shared, not linked to
  identity, ephemeral, for app functionality"** and explain it in the privacy
  policy (citruscare.net/privacy already describes it). Decide at submission;
  do NOT blanket-answer "No" without reading the current policy text.
- Security practices: data is not transmitted, so encryption-in-transit is N/A;
  users can delete all data by clearing app storage or deleting plants.

## Listing draft
- **Title:** Citrus Care — private plant care
- **Short:** Photo plant diagnosis that runs ON your phone. No account, no subscription.
- **Full description:** lead with: photo → diagnosis → timeline → better/worse trend;
  where-to-prune with sourced rules; weather-aware watering; frost alerts;
  everything on-device, nothing uploaded, ever. Link the /guides pages.
- **Category:** House & Home (or Lifestyle). **Ads:** none.
- Screenshots needed (user device or emulator): Plants list w/ photos + Today card,
  Diagnosis, Where-to-prune with marks, Chat, Privacy screen of landing.

## Policy checks
- **BMC link vs Play billing:** donations with nothing unlocked in return are
  generally permitted as an external link; verify at submission against the
  current Payments policy. If challenged: remove the in-app BMC row for the
  Play build (the website keeps it).
- **AI content policy (2026-07-15 update):** we have in-app reporting via the
  feedback mailto; diagnosis/prune outputs carry honest disclaimers. Review the
  AI-Generated Content policy checklist at submission.

## Build
```bash
cd apps/mobile
npx eas-cli build --profile production --platform android   # AAB, or --local
```

# F-Droid prep (parallel track)
- Repo is public; no proprietary services; builds with standard Expo/gradle.
- Blockers to check: F-Droid builds from source — the model downloads at first
  run from Hugging Face (fine; it's user-initiated), and the Expo prebuild must
  be reproducible. Metadata dir (fastlane structure) can be added when pursued.
- License: repo currently "all rights reserved" — F-Droid REQUIRES a FLOSS
  license. Decision needed: relicense (Apache-2.0/GPL) or skip F-Droid.

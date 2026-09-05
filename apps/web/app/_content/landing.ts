export const landingContent = {
  hero: {
    eyebrow: "A little help for everything you grow",
    title: "Plant care,",
    titleAccent: "one photo at a time.",
    // Problem-first, plain words (friend feedback 2026-07-16: "write it like
    // for dummies — otherwise it's not clear").
    description:
      "Yellowing leaves? A plant that’s looking a little tired? Take a photo to explore likely causes, find your next care step, and follow its progress. All on your phone.",
    primaryCta: { label: "Download for Android", href: "#get-the-app" },
  },
  stats: [
    { value: "On-device", label: "Your photos stay with you" },
    { value: "No account", label: "Just you and your plants" },
    // #6 (2026-08-31): the category's loudest documented complaint is
    // subscription traps — name the difference where it scans.
    { value: "No subscription", label: "Free. No trial. No auto-charge." },
  ],
  workflow: [
    {
      title: "Capture the symptom",
      description:
        "Use the in-app camera to frame a leaf, whole plant, or pruning wound in good light — one shutter, no modes.",
    },
    {
      title: "Find your next care step",
      description:
        "Get a health summary, likely causes, and suggested next steps. AI can be wrong, so use the suggestions alongside what you can see and feel.",
    },
    {
      title: "Track recovery — and ask questions",
      description:
        "Compare follow-up photos, see whether a plant is better, same, or worse — and chat about it: answers come from that plant's own record, on your phone.",
    },
  ],
  careModes: [
    {
      icon: "leaf",
      title: "Diagnosis that knows your plant",
      description:
        "Causes come back ranked using your plant's own record — when you watered, recent heat and rain, its species — not generic guesses.",
    },
    {
      icon: "scissors",
      title: "Where to prune",
      description:
        "Photograph the plant and get likely cut areas marked on your photo, over pruning rules sourced from university extension services — with the right season window for your hemisphere.",
    },
    {
      icon: "shield",
      title: "Frost, heat and quarantine alerts",
      description:
        "The night before a frost or heat spike, a notification names which plants to bring in or shade. Citrus in an HLB quarantine ZIP gets flagged too.",
    },
    {
      icon: "history",
      title: "Watering, reminders and a Today view",
      description:
        "Each plant gets a forecast-adjusted watering rhythm, smart re-check reminders, and one Today card saying what actually needs doing.",
    },
  ],
  focusAreas: [
    "Citrus trees",
    "Flowering ornamentals",
    "Indoor plants",
    "Vegetable beds",
    "Cut recovery",
    "Repeat assessments",
  ],
  proof: [
    "A photo history for each plant, from the first concern to the next check-in",
    "Care suggestions informed by your plant’s own record",
    "Questions, watering, and reminders in one place",
  ],
  getApp: {
    title: "Get the app",
    description:
      "Citrus Care is a free Android app. There is no sign-up and no server — your plants, photos, and history live only on your phone.",
    download: {
      label: "Download the APK (161 MB)",
      // Evergreen: releases/latest always points at the newest GitHub Release,
      // so publishing a new release updates this link with no code change.
      href: "https://github.com/ozimid/citrus-care/releases/latest/download/citrus-care.apk",
      // Friend feedback 2026-07-16: "no Play Store? scary to install" — name
      // the warning honestly and let skeptics verify the code themselves.
      note: "Installs directly — no Play Store yet. Your browser will warn about apps from outside the store; that's normal for a direct download.",
      source: {
        label: "Explore the source code on GitHub",
        href: "https://github.com/ozimid/citrus-care",
      },
    },
    requirements: [
      "A recent Android phone with at least 6 GB RAM and about 2 GB of free storage",
      "A one-time ~1.3 GB download for the on-device AI model, over Wi-Fi",
      "The app checks your device before the AI download. Compatibility and assessment speed depend on your phone.",
    ],
    installSteps: [
      "Download the APK from the button above.",
      "Open the downloaded file and tap Install (allow your browser to install apps if asked).",
      "Open Citrus Care and, on first run, download the on-device AI model over Wi-Fi.",
    ],
  },
  privacy: {
    title: "Your plants. Your photos. Your business.",
    body:
      "Your photos and plant records stay on your phone. The AI works there too, with no account or cloud uploads. There’s no automatic sync, so export a backup to keep a copy of your garden. Setup downloads the AI model; optional weather lookups use your plant’s location.",
  },
  support: {
    title: "Support the app",
    body: "Citrus Care is free and always on-device. If it helps your garden, you can buy me a coffee.",
    cta: { label: "Buy me a coffee ☕", href: "https://buymeacoffee.com/citruscare" },
    feedback: {
      prompt: "Found a bug or want a feature?",
      label: "Email feedback@citruscare.net",
      href: "mailto:feedback@citruscare.net?subject=Citrus%20Care%20feedback",
    },
  },
} as const;

export type LandingContent = typeof landingContent;

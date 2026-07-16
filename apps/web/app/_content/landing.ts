export const landingContent = {
  hero: {
    eyebrow: "Private, on-device plant care",
    title: "Citrus Care",
    // Problem-first, plain words (friend feedback 2026-07-16: "write it like
    // for dummies — otherwise it's not clear").
    description:
      "Is your plant dying? Take a photo — the app tells you what's wrong and exactly what to do about it, then reminds you to check back. Like a pet-care app, but for plants. Free, no account, and the AI runs on your phone.",
    primaryCta: { label: "Download for Android", href: "#get-the-app" },
  },
  stats: [
    { value: "On-device", label: "AI — photos never leave your phone" },
    { value: "No account", label: "nothing to sign up for" },
    { value: "Free", label: "no servers, no fees" },
  ],
  workflow: [
    {
      title: "Capture the symptom",
      description:
        "Use the in-app camera to frame a leaf, whole plant, or pruning wound in good light — one shutter, no modes.",
    },
    {
      title: "Get structured diagnosis",
      description:
        "The on-device model returns a scored summary, likely causes, symptom severity, and prioritized next steps.",
    },
    {
      title: "Track recovery",
      description:
        "Compare follow-up photos, see whether a plant is better, same, or worse, and keep the timeline intact.",
    },
  ],
  careModes: [
    {
      icon: "leaf",
      title: "Leaf and stem checks",
      description:
        "Spot chlorosis, pest patterns, watering stress, and nutrient issues across citrus and other garden plants.",
    },
    {
      icon: "scissors",
      title: "Branch wound diagnostics",
      description:
        "Evaluate pruning cuts, collar preservation, dieback risk, and recovery recommendations after trimming.",
    },
    {
      icon: "shield",
      title: "Quarantine alerts",
      description:
        "Flag riskier findings quickly so sensitive plants can be separated while you treat or monitor symptoms.",
    },
    {
      icon: "history",
      title: "Weather-aware watering",
      description:
        "Each plant gets a watering rhythm that adjusts to your local forecast, with a gentle reminder when it's due.",
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
    "Native Android app built with Expo",
    "Everything stays on your phone — no account, nothing synced",
    "On-device AI — your photos are never uploaded",
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
        label: "Don't trust it? The full source code is public — check it on GitHub",
        href: "https://github.com/ozimid/citrus-care",
      },
    },
    requirements: [
      "A recent Android phone with about 2 GB of free storage",
      "A one-time ~1.3 GB download for the on-device AI model, over Wi-Fi",
      "No graphics card or VRAM involved — the AI shares your phone's normal memory. 6 GB+ RAM recommended; weaker devices get an honest “can’t run it” message instead of a broken experience",
    ],
    installSteps: [
      "Download the APK from the button above.",
      "Open the downloaded file and tap Install (allow your browser to install apps if asked).",
      "Open Citrus Care and, on first run, download the on-device AI model over Wi-Fi.",
    ],
  },
  privacy: {
    title: "What leaves your phone: nothing",
    body:
      "There is no account and no server. Photos are analyzed by AI running on the device itself, and your plants and history are stored only on the phone. That also means losing or resetting the phone loses the data — so the app lets you export a backup file whenever you like.",
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

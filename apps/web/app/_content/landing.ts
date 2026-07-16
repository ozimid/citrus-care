export const landingContent = {
  hero: {
    eyebrow: "Private, on-device plant care",
    title: "Citrus Care",
    description:
      "Snap a leaf, a whole tree, or a pruning cut and get a scored diagnosis with ranked care steps — analyzed by AI running on your phone. No account, no cloud, free.",
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
    "On-device AI (Gemma) — your photos are never uploaded",
  ],
  getApp: {
    title: "Get the app",
    description:
      "Citrus Care is a free Android app. There is no sign-up and no server — your plants, photos, and history live only on your phone.",
    download: {
      label: "Download the APK",
      // Replaced with the built APK URL once the app is published.
      href: "#",
      note: "Installs directly — no Play Store. Your browser will ask you to allow installing apps the first time.",
    },
    requirements: [
      "A recent Android phone with about 2 GB of free storage",
      "A one-time ~1.3 GB download for the on-device AI model, over Wi-Fi",
      "Works best on a higher-memory phone — weaker devices get an honest “can’t run it” message instead of a broken experience",
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
    // Replaced with the real Buy Me a Coffee page.
    cta: { label: "Buy me a coffee ☕", href: "https://www.buymeacoffee.com/" },
  },
} as const;

export type LandingContent = typeof landingContent;

export const landingContent = {
  hero: {
    eyebrow: "Photo-driven plant care",
    title: "Citrus Care",
    description:
      "Diagnose leaves, stems, pruning cuts, and recovery trends from one focused photo, then keep every plant's care history in one practical timeline — on your phone.",
    primaryCta: { label: "Get the app", href: "#get-the-app" },
  },
  stats: [
    { value: "1 photo", label: "to start an assessment" },
    { value: "100 pt", label: "health score history" },
    { value: "4 flows", label: "leaves, stems, cuts, recovery" },
  ],
  workflow: [
    {
      title: "Capture the symptom",
      description:
        "Use the in-app camera flow to frame a leaf, stem, flower, or pruning wound in good light.",
    },
    {
      title: "Get structured diagnosis",
      description:
        "Citrus Care returns a scored summary, likely causes, symptom severity, and prioritized next steps.",
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
      title: "Visual recovery records",
      description:
        "Keep before-and-after views beside the diagnosis timeline so progress is visible, not just remembered.",
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
    "Photos stay on your phone — only the structured diagnosis is synced",
    "Gemini-powered structured assessment schema",
  ],
  getApp: {
    title: "Get the app",
    description:
      "Citrus Care is a native Android app. Your plant photos never leave the phone — only the structured diagnosis is stored with your account.",
    android: {
      platform: "Android",
      note: "Development build — ask Oleksii for the current install link.",
    },
  },
} as const;

export type LandingContent = typeof landingContent;

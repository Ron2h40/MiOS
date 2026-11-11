import type { ResourceItem, SourceRef } from "./resources";

/**
 * C3: one-tap presets.
 *
 * Medicine shapes are built from FDA prescribing information on DailyMed
 * (read 2026-11-05). Labels give time to peak and sometimes how long effects
 * lasted in studies; none of them states an onset time. Anything a label
 * doesn't state is marked as a MiOS estimate, and every user can adjust
 * strength and duration (C4). Effect sizes (percentage points) are MiOS's own
 * modeling choice, not label data.
 */

const RITALIN: SourceRef = {
  title: "Ritalin (methylphenidate HCl) tablets, FDA label",
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d6fb2750-cdab-4749-ba0d-7534840a5892",
  revised: "2/2025",
  section: "12.3 Pharmacokinetics",
  quote: "Peak plasma concentrations … were reached on an average of 2 hours after administration of 10 mg tablet.",
};

const CONCERTA_PK: SourceRef = {
  title: "Concerta (methylphenidate HCl) extended-release tablets, FDA label",
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=1a88218c-5b18-4220-8f56-526de1a276cd",
  revised: "4/2026",
  section: "12.3 Pharmacokinetics",
  quote:
    "Reached an initial maximum concentration at about 1 hour, followed by gradual ascending concentrations over the next 5 to 9 hours … Mean times to reach peak plasma concentrations across all doses of CONCERTA occurred between 6 and 10 hours.",
};
const CONCERTA_EFFECT: SourceRef = {
  ...CONCERTA_PK,
  section: "14.2 Clinical Studies (children 6–12)",
  quote: "These results were maintained through 12 hours after dosing.",
};
const CONCERTA_HALF: SourceRef = {
  ...CONCERTA_PK,
  quote: "The half-life of methylphenidate in adults and adolescents following oral CONCERTA administration was approximately 3.5 hours.",
};

const ADDERALL: SourceRef = {
  title: "Adderall (mixed amphetamine salts) tablets, FDA label",
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f22635fe-821d-4cde-aa12-419f8b53db81",
  revised: "5/2024",
  section: "Clinical Pharmacology",
  quote:
    "Following administration of a single dose 10 or 30 mg of Adderall® to healthy volunteers under fasted conditions, peak plasma concentrations occurred approximately 3 hours post-dose for both d-amphetamine and l-amphetamine.",
};
const ADDERALL_HALF: SourceRef = {
  ...ADDERALL,
  quote: "The mean elimination half-life (t1/2) for d-amphetamine was shorter than the t1/2 of the l-isomer (9.77 to 11 hours vs. 11.5 to 13.8 hours).",
};

const ADDERALL_XR: SourceRef = {
  title: "Adderall XR (mixed amphetamine salts) extended-release capsules, FDA label",
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=aff45863-ffe1-4d4f-8acf-c7081512a6c0",
  revised: "4/2026",
  section: "12.3 Pharmacokinetics",
  quote:
    "The time to reach maximum plasma concentration (Tmax) for ADDERALL XR is about 7 hours, which is about 4 hours longer compared to ADDERALL (immediate-release).",
};
const ADDERALL_XR_EFFECT: SourceRef = {
  ...ADDERALL_XR,
  section: "14 Clinical Studies (children 6–12)",
  quote: "Patients who received ADDERALL XR showed behavioral improvements in both morning and afternoon assessments compared to patients on placebo.",
};
const ADDERALL_XR_HALF: SourceRef = { ...ADDERALL_XR, quote: "The mean elimination half-life for d-amphetamine is 10 hours in adults." };

const VYVANSE_PK: SourceRef = {
  title: "Vyvanse (lisdexamfetamine dimesylate), FDA label",
  url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=704e4378-ca83-445c-8b45-3cfa51c1ecad",
  revised: "4/2026",
  section: "12.3 Pharmacokinetics",
  quote: "Food prolongs Tmax by approximately 1 hour (from 3.8 hours at fasted state to 4.7 hours after a high fat meal or to 4.2 hours with yogurt).",
};
const VYVANSE_EFFECT: SourceRef = {
  ...VYVANSE_PK,
  section: "14.1 Clinical Studies (Study 8, adults)",
  quote:
    "The PERMP assessments were administered at pre-dose (-0.5 hours) and at 2, 4, 8, 10, 12, and 14 hours post-dose … resulted in a statistically significant improvement in attention across all post-dose time points.",
};
const VYVANSE_HALF: SourceRef = {
  ...VYVANSE_PK,
  section: "12.3 Pharmacokinetics",
  quote: "The plasma elimination half-life of dextroamphetamine was approximately … 10 to 11.3 hours in healthy adults.",
};

const CAFFEINE: SourceRef = {
  title: "Caffeine, PubChem (citing ASHP Drug Information 2013)",
  url: "https://pubchem.ncbi.nlm.nih.gov/compound/Caffeine",
  revised: "read 2026-11-05",
  section: "Absorption, Distribution and Excretion",
  quote: "Following oral administration of 100 mg of caffeine (as coffee), peak plasma concentrations of about 1.5-1.8 ug/mL are reached after 50-75 minutes.",
};
const CAFFEINE_HALF: SourceRef = { ...CAFFEINE, section: "Biological Half-Life", quote: "Caffeine has a plasma half-life (t1/2) of 3 to 5 hours in adults." };

const NO_ONSET = { value: "not stated", basis: "estimate" as const, note: "The label gives no onset time. MiOS starts the rise right after you take it." };

export const RESOURCE_PRESETS: readonly ResourceItem[] = [
  // Drinks
  {
    id: "water",
    name: "Water",
    icon: "💧",
    kind: "drink",
    serving: "1 glass (250 ml)",
    effects: { hydration: 25 },
    shape: [[0, 0], [0.25, 1], [3, 0.6], [6, 0]],
  },
  {
    id: "coffee",
    name: "Coffee",
    icon: "☕",
    kind: "drink",
    serving: "1 cup (about 95 mg caffeine)",
    effects: { focus: 20, energy: 12, hydration: 5 },
    // Peak about 1 h, then halves roughly every 4 h (3–5 h half-life).
    shape: [[0, 0], [0.25, 0.4], [1, 1], [5, 0.5], [9, 0.25], [13, 0]],
    facts: {
      peak: { value: "50–75 minutes", basis: "reference", source: CAFFEINE },
      halfLife: { value: "3–5 hours", basis: "reference", source: CAFFEINE_HALF },
    },
  },
  {
    id: "tea",
    name: "Tea",
    icon: "🍵",
    kind: "drink",
    serving: "1 cup (about 45 mg caffeine)",
    effects: { focus: 10, energy: 6, hydration: 12 },
    shape: [[0, 0], [0.25, 0.4], [1, 1], [5, 0.5], [9, 0.25], [13, 0]],
  },
  // Food
  {
    id: "meal",
    name: "Meal",
    icon: "🍽",
    kind: "food",
    serving: "1 full meal",
    effects: { energy: 35, hydration: 5 },
    shape: [[0, 0], [0.5, 0.6], [1, 1], [3, 0.6], [5, 0]],
  },
  {
    id: "snack",
    name: "Snack",
    icon: "🍪",
    kind: "food",
    serving: "1 snack",
    effects: { energy: 12 },
    shape: [[0, 0], [0.3, 1], [1.5, 0.3], [2, 0]],
  },
  // Sleep
  {
    id: "sleep",
    name: "Sleep",
    icon: "😴",
    kind: "sleep",
    serving: "Hours slept last night",
    effects: {},
    shape: [[0, 0]],
  },
  // Medicines (prescription focus medications)
  {
    id: "methylphenidate-ir",
    name: "Ritalin",
    detail: "Methylphenidate HCl, immediate-release",
    icon: "💊",
    kind: "medicine",
    serving: "1 dose as prescribed",
    effects: { focus: 40 },
    shape: [[0, 0], [0.5, 0.4], [2, 1], [3, 0.8], [4, 0.3], [5, 0]],
    facts: {
      onset: NO_ONSET,
      peak: { value: "about 2 hours", basis: "label", source: RITALIN },
      duration: { value: "about 4 hours", basis: "estimate", note: "Not stated in the label. Adjust duration under tolerance to match your experience." },
    },
  },
  {
    id: "methylphenidate-er",
    name: "Concerta",
    detail: "Methylphenidate HCl, extended-release",
    icon: "💊",
    kind: "medicine",
    serving: "1 dose as prescribed",
    effects: { focus: 40 },
    // Early bump at ~1 h, rising to a peak at ~6.8 h, effects through ~12 h.
    shape: [[0, 0], [1, 0.6], [2, 0.65], [6.8, 1], [10, 0.85], [12, 0.6], [14, 0]],
    facts: {
      onset: NO_ONSET,
      peak: { value: "first rise at about 1 hour, peak at 6–10 hours", basis: "label", source: CONCERTA_PK },
      duration: { value: "through 12 hours", basis: "label", source: CONCERTA_EFFECT, note: "Measured in children 6–12. MiOS fades it out over the next 2 hours." },
      halfLife: { value: "about 3.5 hours", basis: "label", source: CONCERTA_HALF },
    },
  },
  {
    id: "amphetamine-ir",
    name: "Adderall",
    detail: "Mixed amphetamine salts, immediate-release",
    icon: "💊",
    kind: "medicine",
    serving: "1 dose as prescribed",
    effects: { focus: 40, energy: 10 },
    shape: [[0, 0], [0.5, 0.3], [3, 1], [5, 0.6], [7, 0]],
    facts: {
      onset: NO_ONSET,
      peak: { value: "about 3 hours", basis: "label", source: ADDERALL },
      duration: { value: "about 6 hours", basis: "estimate", note: "Not stated in the label. Half-life (about 10 hours) is longer than the felt effect." },
      halfLife: { value: "about 10–11 hours (d-amphetamine)", basis: "label", source: ADDERALL_HALF },
    },
  },
  {
    id: "amphetamine-xr",
    name: "Adderall XR",
    detail: "Mixed amphetamine salts, extended-release",
    icon: "💊",
    kind: "medicine",
    serving: "1 dose as prescribed",
    effects: { focus: 40, energy: 10 },
    shape: [[0, 0], [1, 0.4], [3, 0.75], [7, 1], [10, 0.8], [12, 0.4], [14, 0]],
    facts: {
      onset: NO_ONSET,
      peak: { value: "about 7 hours (later after a high-fat meal)", basis: "label", source: ADDERALL_XR },
      duration: { value: "about 12 hours", basis: "estimate", source: ADDERALL_XR_EFFECT, note: "The label reports morning and afternoon effects but no hours. MiOS assumes about 12." },
      halfLife: { value: "about 10 hours (d-amphetamine, adults)", basis: "label", source: ADDERALL_XR_HALF },
    },
  },
  {
    id: "lisdexamfetamine",
    name: "Vyvanse",
    detail: "Lisdexamfetamine dimesylate",
    icon: "💊",
    kind: "medicine",
    serving: "1 dose as prescribed",
    effects: { focus: 40, energy: 10 },
    shape: [[0, 0], [1, 0.25], [2, 0.6], [3.8, 1], [10, 0.9], [14, 0.5], [16, 0]],
    facts: {
      onset: NO_ONSET,
      peak: { value: "about 3.8 hours fasted, 4.7 after a high-fat meal", basis: "label", source: VYVANSE_PK },
      duration: { value: "through 14 hours (adult study)", basis: "label", source: VYVANSE_EFFECT, note: "MiOS fades it out over the following 2 hours." },
      halfLife: { value: "about 10–11 hours (dextroamphetamine, adults)", basis: "label", source: VYVANSE_HALF },
    },
  },
];

export const PRESETS_BY_ID: ReadonlyMap<string, ResourceItem> = new Map(RESOURCE_PRESETS.map((p) => [p.id, p]));

export const MEDICINE_DISCLAIMER =
  "For personal tracking only. Not medical advice. Curves are rough shapes based on published prescribing information and averages from studies; your body may differ. Never change how you take a medicine because of this app. Talk to your prescriber.";

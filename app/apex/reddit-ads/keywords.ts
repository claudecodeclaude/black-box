// Keywords model for the Reddit Ads scraper.
//
// Lifecycle:
//   base (Jason-approved) ── scrape uses this every run
//        ▲
//        │ approve
//   candidates (≥10 mentions, needs review)
//        │ reject
//        ▼
//   rejected (never re-suggested)
//
//   misspellings ── auto-added every scrape (no approval needed)
//
// When Jason approves/rejects in the UI, the action writes to localStorage.
// The next scan (run via Claude Code) reads both the committed files AND the
// localStorage export to materialize approvals into this source-of-truth file.

export type CategoryName =
  | "Neuropathy"
  | "Disc / Spine"
  | "Sciatica / Radicular"
  | "Back & Neck Pain";

export const baseKeywords: Record<CategoryName, string[]> = {
  "Neuropathy": [
    "neuropathy",
    "peripheral neuropathy",
    "diabetic neuropathy",
    "idiopathic neuropathy",
    "chemo neuropathy",
    "chemo-induced neuropathy",
    "chemo induced neuropathy",
    "post-chemo neuropathy",
    "post chemo neuropathy",
    "chemotherapy neuropathy",
    "chemotherapy induced neuropathy",
    "small fiber neuropathy",
    "large fiber neuropathy",
    "autonomic neuropathy",
    "sensory neuropathy",
    "motor neuropathy",
    "alcoholic neuropathy",
    "alcohol neuropathy",
    "alcohol-induced neuropathy",
    "alcohol induced neuropathy",
    "agent orange neuropathy",
    "agent orange peripheral neuropathy",
    "agent orange nerve damage",
    "agent orange nerve pain",
    "nerve damage",
    "nerve pain",
    "nerve pains",
  ],
  "Disc / Spine": [
    "herniated disc",
    "herniated discs",
    "herniated disk",
    "herniated disks",
    "bulging disc",
    "bulging discs",
    "bulging disk",
    "bulging disks",
    "slipped disc",
    "slipped discs",
    "slipped disk",
    "slipped disks",
    "degenerative disc disease",
    "degenerative disk disease",
    "DDD",
    "pinched nerve",
    "pinched nerves",
    "spinal stenosis",
    "L4-L5",
    "L5-S1",
    "C5-C6",
    "C6-C7",
    "L4 L5",
    "L5 S1",
    "C5 C6",
    "C6 C7",
  ],
  "Sciatica / Radicular": [
    "sciatica",
    "sciatic nerve",
    "sciatic pain",
    "radiculopathy",
    "radiculopathies",
    "radiating pain",
    "radiating nerve pain",
  ],
  "Back & Neck Pain": [
    "back pain",
    "lower back pain",
    "low back pain",
    "upper back pain",
    "mid back pain",
    "chronic back pain",
    "acute back pain",
    "neck pain",
    "chronic neck pain",
    "chronic pain",
  ],
};

// Auto-added by the scrape pipeline whenever a new spelling variation is
// detected. No approval required.
export const misspellings: string[] = [
  // Neuropathy
  "nueropathy",
  "neropathy",
  "neruopathy",
  "neuropothy",
  "neurpathy",
  "nuropathy",
  "neuropaty",
  "nuropothy",
  "peripheral nueropathy",
  "nueropathy peripheral",
  "diabetic nueropathy",
  "diabetic neropathy",
  "chemo nueropathy",
  // Disc
  "dsic",
  "dics",
  "hernated disc",
  "hernaited disc",
  "hernaiated disc",
  "hernatied disc",
  "hurniated disc",
  "herneated disc",
  "buldging disc",
  "buldging disk",
  "buldging disks",
  "slpped disc",
  "sliped disc",
  // Sciatica
  "siatica",
  "ciatica",
  "sciatca",
  "sciatia",
  "syatica",
  "psciatica",
  "sciattica",
  "radiculopothy",
  "radicolopathy",
  "radicalopathy",
  "radioculopathy",
];

export type Candidate = {
  term: string;
  count: number;
  firstSeen: string;
  suggestedCategory: CategoryName;
  example?: string;
};

// Candidates queued for Jason's review. Populated when a term that's not
// already in baseKeywords or rejected gets mentioned ≥10 times in a scrape.
export const candidates: Candidate[] = [
  {
    term: "polyneuropathy",
    count: 47,
    firstSeen: "2026-04-14",
    suggestedCategory: "Neuropathy",
    example: "My GP diagnosed me with polyneuropathy after the nerve conduction test.",
  },
  {
    term: "spondylolisthesis",
    count: 28,
    firstSeen: "2026-04-14",
    suggestedCategory: "Disc / Spine",
    example: "Grade 2 spondylolisthesis at L5-S1 has been ruining my life for years.",
  },
  {
    term: "neuropathic pain",
    count: 22,
    firstSeen: "2026-04-14",
    suggestedCategory: "Neuropathy",
    example: "The neuropathic pain kept me awake for the entire first week.",
  },
  {
    term: "facet joint syndrome",
    count: 14,
    firstSeen: "2026-04-14",
    suggestedCategory: "Disc / Spine",
    example: "Turns out it wasn't a disc problem at all — it was facet joint syndrome.",
  },
];

// Rejected terms — never re-suggested.
export const rejected: string[] = [];

// Subreddits browsed in full (pagination through new + top) during every scan,
// in addition to site-wide keyword searches.
export const targetSubreddits: string[] = [
  "ChronicPain",
  "chronicpain",
  "neuropathy",
  "backpain",
  "herniateddisc",
  "sciatica",
  "diabetes",
  "Fibromyalgia",
  "AskDocs",
  "spinalstenosis",
];

// Flat list for the scraper.
export function allActiveKeywords(): string[] {
  const base = Object.values(baseKeywords).flat();
  return [...base, ...misspellings];
}

export function totalKeywordCount(): number {
  return Object.values(baseKeywords).flat().length + misspellings.length;
}

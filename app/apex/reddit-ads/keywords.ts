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
  | "Sciatica / Radicular";

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
    "polyneuropathy",
    "neuropathic pain",
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
export const candidates: Candidate[] = [];

// Rejected terms — never re-suggested. Can include original base keywords or
// misspellings that Jason rejects from the popup menu; the scan runbook moves
// them out of their source list into here.
export const rejected: string[] = [
  "spondylolisthesis",
  "facet joint syndrome",
];

// Direct-hit counts for each active keyword — how many times that exact
// surface form was found across the corpus, refreshed every scan. Populated
// by the extraction step in the "update reddit ads" runbook.
// Missing keys render as "—" in the UI.
export const hitCounts: Record<string, number> = {
  "neuropathy": 18472,
  "peripheral neuropathy": 6213,
  "diabetic neuropathy": 4892,
  "small fiber neuropathy": 1245,
  "chemo induced neuropathy": 987,
  "nerve pain": 9384,
  "herniated disc": 12801,
  "herniated disk": 4122,
  "bulging disc": 3219,
  "slipped disc": 1877,
  "pinched nerve": 5234,
  "spinal stenosis": 2498,
  "sciatica": 15329,
  "sciatic nerve": 2874,
  "radiculopathy": 1021,
  "radiating pain": 3512,
  "nueropathy": 847,
  "siatica": 412,
  "hernated disc": 288,
  "buldging disc": 175,
};

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

export type Topic = {
  slug: string;
  name: string;
  count: number;
  subreddits?: string[];
  authenticHooks: string[];
  fbHooks: string[];
  videoIdeas: string[];
  quotes: string[];
};

export type Report = {
  generatedAt: string;
  keywordSet: string;
  topics: Topic[];
};

export const report: Report = {
  generatedAt: "2026-04-14T00:00:00Z",
  keywordSet: "neuropathy + disc issues",
  topics: [
    {
      slug: "gabapentin",
      name: "Gabapentin",
      count: 847,
      subreddits: ["r/ChronicPain", "r/neuropathy", "r/backpain"],
      authenticHooks: [
        "If gabapentin isn't working for you either, you're not imagining it.",
        "I took gabapentin for 3 years and all it did was make me forget things.",
        "Nobody told me gabapentin would mess with my memory like this.",
        "My neurologist kept raising my gabapentin dose. It never helped.",
        "Everyone on Reddit said gabapentin would change my life. It didn't.",
        "I switched off gabapentin last month. Here's what actually changed.",
        "Why does every doctor hand out gabapentin like candy?",
        "I wish somebody told me what gabapentin withdrawal feels like.",
        "Gabapentin didn't touch my nerve pain. This is what did.",
        "Stop letting your doctor push gabapentin without asking this one question.",
      ],
      fbHooks: [
        "The nerve pain medication doctors won't tell you the truth about.",
        "Taking gabapentin? Watch this before your next refill.",
        "What your neurologist isn't telling you about gabapentin.",
        "I stopped taking gabapentin after 3 years. Here's what happened.",
        "The #1 mistake people make on gabapentin.",
        "Gabapentin users: you need to see this.",
        "If you're still in pain on gabapentin, there's a reason.",
        "Why gabapentin stops working after a few months.",
        "Doctors prescribe this for nerve pain. It barely works.",
        "Before you take another gabapentin, read this.",
      ],
      videoIdeas: [
        "Unboxing my 'gabapentin graveyard' — every bottle I was prescribed over 3 years",
        "Reading real Reddit comments from gabapentin users (reacting in real time)",
        "A day in the life on max-dose gabapentin (memory, fatigue, fog)",
        "What I tried before and after quitting gabapentin",
        "My neurologist vs. Reddit: who was right about gabapentin?",
        "Gabapentin side effects nobody warned me about",
        "Tapering off gabapentin week-by-week (video diary)",
        "The moment I realized gabapentin wasn't working",
        "Gabapentin myths I believed for years",
        "What I wish I asked my doctor before starting gabapentin",
      ],
      quotes: [
        "gabapentin just made me a zombie",
        "I don't remember most of 2023 because of gabapentin",
        "my doctor kept upping the dose like that would fix it",
        "gabapentin turned me into a different person",
        "I'm finally off gabapentin and I can think again",
        "it takes the edge off but it doesn't stop the pain",
        "everyone I know on gabapentin has gained weight",
        "gabapentin withdrawal is real and nobody warned me",
        "I tapered off gabapentin over 6 months",
        "honestly gabapentin did nothing for my neuropathy",
      ],
    },
    {
      slug: "alpha-lipoic-acid",
      name: "Alpha-Lipoic Acid",
      count: 612,
      subreddits: ["r/neuropathy", "r/diabetes"],
      authenticHooks: [
        "Alpha lipoic acid was the one thing that actually helped my feet.",
        "I was skeptical about ALA. 3 months later I'm a believer.",
        "If you haven't tried alpha lipoic acid yet, read this first.",
      ],
      fbHooks: [
        "The supplement neurologists don't mention for nerve pain.",
        "This $20 supplement changed my neuropathy.",
      ],
      videoIdeas: [
        "90-day alpha lipoic acid experiment — what changed",
        "ALA dosage: what Reddit users actually take",
      ],
      quotes: [
        "alpha lipoic acid saved my feet",
        "I take 600mg twice a day and it works",
      ],
    },
    {
      slug: "mcgill-method",
      name: "McGill Method",
      count: 489,
      subreddits: ["r/backpain", "r/herniateddisc"],
      authenticHooks: [
        "The McGill method fixed my herniated disc when nothing else did.",
      ],
      fbHooks: [
        "Herniated disc? Don't do another core workout until you see this.",
      ],
      videoIdeas: [
        "30 days of the McGill Big 3 — before/after",
      ],
      quotes: [
        "the mcgill big 3 changed my life",
      ],
    },
    {
      slug: "cymbalta",
      name: "Cymbalta (Duloxetine)",
      count: 421,
      subreddits: ["r/ChronicPain", "r/neuropathy"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "mri-results",
      name: "MRI Results / Interpretation",
      count: 398,
      subreddits: ["r/backpain", "r/herniateddisc"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "inversion-table",
      name: "Inversion Table",
      count: 312,
      subreddits: ["r/backpain"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "microdiscectomy",
      name: "Microdiscectomy Surgery",
      count: 287,
      subreddits: ["r/herniateddisc", "r/backpain"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "lyrica",
      name: "Lyrica (Pregabalin)",
      count: 264,
      subreddits: ["r/ChronicPain", "r/neuropathy"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "decompression-traction",
      name: "Spinal Decompression / Traction",
      count: 241,
      subreddits: ["r/backpain", "r/herniateddisc"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
    {
      slug: "stem-cell-therapy",
      name: "Stem Cell Therapy",
      count: 198,
      subreddits: ["r/backpain", "r/ChronicPain"],
      authenticHooks: [],
      fbHooks: [],
      videoIdeas: [],
      quotes: [],
    },
  ],
};

export function findTopic(slug: string): Topic | undefined {
  return report.topics.find((t) => t.slug === slug);
}

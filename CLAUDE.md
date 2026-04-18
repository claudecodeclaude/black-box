# Black Box — Claude Code runbook

Personal app hub. Two groups of apps:
- **Apps** (`app/*`): Ninja Lab (`app/ninja`), Claude Code tile (external link)
- **Apex App Projects** (`app/apex/*`): tools that will graduate to the Apex App. Currently QR Generator (`app/apex/qr`) and Reddit Ads (`app/apex/reddit-ads`)

Deployed to Vercel: https://black-box-orpin.vercel.app (auto-deploys on push to `main`).

After every change, **commit and push** — Jason tests on his iPhone.

## Runbook: `update reddit ads`

When Jason says "update reddit ads" (usually via the red UPDATE banner → ttyd → this session), run the full bi-weekly pipeline. The tool runs **entirely in Claude Code** — no Anthropic API usage, no paid services.

### 1. Preflight

- Confirm `.env.local` exists with the four Reddit creds: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`. If missing, stop and ask Jason to paste them.
- Check `data/reddit-corpus/index.json` — if it doesn't exist or is empty, this is a **bootstrap** run. Otherwise **incremental**.

### 2. Scrape

```bash
# Bootstrap (first run only — takes 1–2 hours):
npm run reddit:bootstrap

# Incremental (every subsequent run — ~20–40 min):
npm run reddit:incremental
```

Script lives at `scripts/fetch-reddit.ts`. It:
- Pulls posts from site-wide keyword searches + full per-subreddit browsing of `targetSubreddits`
- Dedupes by post ID via `data/reddit-corpus/index.json`
- Saves each post + full comment tree (including MoreChildren resolution) to `data/reddit-corpus/YYYY-MM-DD/{postId}.json`
- Rate-limited at ~55 req/min, under Reddit's 100/min cap

Corpus files are gitignored. Only the index is committed.

### 3. Apply pending keyword actions

Before extraction, read `data/keywords-overlay.json` if present (written by the Mac helper server from Jason's approve/reject clicks):

```jsonc
{
  "approved": [{"term": "polyneuropathy", "category": "Neuropathy"}],
  "rejected": ["foot pain"]
}
```

For each approved term: move from `candidates` into `baseKeywords[category]` in `app/apex/reddit-ads/keywords.ts`.
For each rejected term: add to `rejected`, AND remove it from wherever it currently lives — `candidates`, `baseKeywords` (any category), or `misspellings`. Jason can reject a previously-approved base keyword via the popup menu, so handle all three sources.

Then delete `data/keywords-overlay.json`.

### 4. Extract entities from new corpus content

Walk posts newly added this run (read `data/reddit-corpus/index.json` and filter by `fetchedAt` since the last extraction — tracked in `data/extraction-state.json`).

**Batching.** Process ~5 posts at a time to keep context manageable. For each batch:

1. Read the post JSON files
2. For each comment in the tree (flatten replies), extract:
   - **Specific named entities**: exact medication names (brand AND generic separately — Gabapentin and Neurontin are two entries), exact procedure names, exact product brands, exact doctor/provider names, exact supplement names, specific symptoms
   - **Surface form**: whatever the commenter literally wrote (preserve casing, misspellings)
   - **Verbatim quotes**: short phrases illustrating how each entity is discussed (under 20 words)
3. Keep a running aggregate across the session

**Extraction rules** (these are hard constraints Jason has set):
- **Never collapse brand and generic** — "Gabapentin" and "Neurontin" are two topics, not one
- **Specific over general** — don't extract "pain medication"; extract "Gabapentin", "Cymbalta", etc. If a comment says "I took a pain med" with no specifics, skip it
- **Preserve spelling** — if someone writes "nueropathy" that's a hit for that surface form, not "neuropathy"

### 5. Detect candidates and misspellings

After aggregation:

- **New misspellings**: any term that appears ≥3 times, isn't in `baseKeywords` or `misspellings`, and is clearly a spelling variant (1–3 edit distance) of an existing term → add directly to `misspellings` array in `keywords.ts`. No approval needed.
- **New candidates**: any term that appears ≥10 times, isn't in `baseKeywords`/`misspellings`/`rejected`, and isn't a misspelling → add to `candidates` in `keywords.ts` with count, firstSeen, suggestedCategory (pick based on semantic fit), and an example quote.

### 6. Update topics

In `app/apex/reddit-ads/data.ts`, merge new counts into existing `topics`:
- For every extracted entity, either increment the existing topic's count or add a new topic
- Update `subreddits` on each topic to reflect where most mentions came from
- Keep only the top 50 topics by count — drop the rest
- For the top 50, refresh the four content lists if the topic gained >20% more mentions since last run:
  - `authenticHooks` (10): rewrite/expand based on latest comment language
  - `fbHooks` (10): regenerate using known high-performing ad patterns (curiosity gap, pattern interrupt, negative framing, callout, specificity)
  - `videoIdeas` (10): concept-only, no scripts. Jason shoots these as talking-head, uncut-style
  - `quotes` (10): verbatim top quotes across the corpus for that topic — preserve exact wording, typos and all

Finally set `generatedAt` to now (ISO), update `keywordSet` if the active keyword list meaningfully changed.

### 6b. Refresh hitCounts

Update `hitCounts` in `app/apex/reddit-ads/keywords.ts` — for every active term (base + misspellings), count exact-surface-form occurrences in the corpus (case-insensitive for English, case-sensitive for things like "DDD" or "L4-L5"). This is what the keyword popup's "Direct Hits" line displays.

### 7. Record extraction state

Write `data/extraction-state.json`:
```json
{
  "lastRunAt": "<ISO>",
  "lastCorpusIndexHash": "<short hash of index.json>"
}
```
This is committed so next run knows what's new.

### 8. Commit + push

```bash
git add app/apex/reddit-ads/data.ts app/apex/reddit-ads/keywords.ts data/reddit-corpus/index.json data/extraction-state.json
git commit -m "..."
git push
```

Commit message should include:
- Run mode (bootstrap / incremental)
- Posts fetched this run
- Topics added/removed/changed
- Misspellings auto-added
- Candidates queued / applied

### 9. Report back to Jason

One short summary: how many posts scraped, how many new topics, how many misspellings auto-added, how many candidates now waiting for his review. Mention the URL: https://black-box-orpin.vercel.app/apex/reddit-ads

## Conventions

- **Free path only**: never call the Anthropic API for this project. All LLM work runs in this Claude Code session (Jason pays for Max; he doesn't pay for API).
- **Brand/generic stay separate**: never pre-merge synonyms at extraction time. Let Jason see both.
- **Specific over general**: topics must name exact entities.
- **Preserve real language**: quotes are verbatim, including typos — that's the whole point.
- **Push after every working change**: Jason tests on his phone.

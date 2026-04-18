#!/usr/bin/env node
// Reddit scraper for the Reddit Ads pipeline.
//
//   npx tsx scripts/fetch-reddit.ts --test          # 5 posts for one keyword, one sub
//   npx tsx scripts/fetch-reddit.ts --bootstrap     # wide initial pull
//   npx tsx scripts/fetch-reddit.ts --incremental   # new posts + comments in last 14 days
//
// Requires in .env.local:
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
//   REDDIT_USER_AGENT (optional, defaults to black-box-ads-scrape/0.1)

import fs from "node:fs";
import path from "node:path";
import {
  allActiveKeywords,
  targetSubreddits,
} from "../app/apex/reddit-ads/keywords";

// ---- env ---------------------------------------------------------------------

function loadEnvLocal() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const CLIENT_ID = required("REDDIT_CLIENT_ID");
const CLIENT_SECRET = required("REDDIT_CLIENT_SECRET");
const USERNAME = required("REDDIT_USERNAME");
const PASSWORD = required("REDDIT_PASSWORD");
const USER_AGENT = process.env.REDDIT_USER_AGENT || "black-box-ads-scrape/0.1";

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
  return v;
}

// ---- rate limit --------------------------------------------------------------

let lastCall = 0;
const MIN_INTERVAL_MS = 1100; // ~55 req/min, under Reddit's 100/min cap

async function throttle() {
  const elapsed = Date.now() - lastCall;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastCall = Date.now();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---- auth --------------------------------------------------------------------

type Token = { accessToken: string; expiresAt: number };
let token: Token | null = null;

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  token = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return token.accessToken;
}

// ---- api ---------------------------------------------------------------------

async function redditGet<T = any>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  await throttle();
  const at = await getToken();
  const url = new URL(`https://oauth.reddit.com${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("raw_json", "1");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${at}`,
      "User-Agent": USER_AGENT,
    },
  });

  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "10");
    console.warn(`rate limited, sleeping ${retry}s`);
    await sleep(retry * 1000);
    return redditGet<T>(endpoint, params);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GET ${url.pathname} → ${res.status} ${body.slice(0, 200)}`
    );
  }
  return res.json() as Promise<T>;
}

// ---- domain types ------------------------------------------------------------

type Post = {
  id: string;
  subreddit: string;
  title: string;
  selftext?: string;
  author: string;
  created_utc: number;
  permalink: string;
  score: number;
  num_comments: number;
  url?: string;
};

type Comment = {
  id: string;
  parent_id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  replies: Comment[];
};

type Listing<T> = {
  data: { after: string | null; children: { kind: string; data: T }[] };
};

// ---- discovery ---------------------------------------------------------------

async function searchSiteWide(
  keyword: string,
  sort: "new" | "top" | "relevance",
  t: "year" | "month" | "all" | "week",
  limit = 100
): Promise<Post[]> {
  const data = await redditGet<Listing<Post>>("/search.json", {
    q: keyword,
    sort,
    t,
    limit,
    type: "link",
  });
  return data.data.children.map((c) => c.data);
}

async function searchInSub(
  subreddit: string,
  keyword: string,
  sort: "new" | "top" | "relevance",
  t: "year" | "month" | "all" | "week",
  limit = 100
): Promise<Post[]> {
  const data = await redditGet<Listing<Post>>(
    `/r/${subreddit}/search.json`,
    { q: keyword, sort, t, limit, restrict_sr: "true", type: "link" }
  );
  return data.data.children.map((c) => c.data);
}

async function browseSub(
  subreddit: string,
  sort: "new" | "top" | "hot",
  t: "year" | "month" | "all" | "week" | undefined,
  limit = 100
): Promise<Post[]> {
  const data = await redditGet<Listing<Post>>(`/r/${subreddit}/${sort}.json`, {
    t,
    limit,
  });
  return data.data.children.map((c) => c.data);
}

// ---- comments ---------------------------------------------------------------

async function fetchComments(
  subreddit: string,
  postId: string
): Promise<Comment[]> {
  const data = await redditGet<any[]>(
    `/r/${subreddit}/comments/${postId}.json`,
    { limit: 500, depth: 10 }
  );
  const listing = data[1]?.data?.children ?? [];
  return walkComments(postId, listing);
}

async function walkComments(postId: string, children: any[]): Promise<Comment[]> {
  const out: Comment[] = [];
  for (const c of children) {
    if (c.kind === "more") {
      const more = c.data;
      const childIds: string[] = more?.children ?? [];
      if (childIds.length === 0) continue;
      try {
        const extra = await resolveMoreChildren(postId, childIds);
        out.push(...extra);
      } catch (e) {
        console.warn(`morechildren failed (post ${postId}): ${(e as Error).message}`);
      }
    } else if (c.kind === "t1") {
      const d = c.data;
      if (!d.body || d.body === "[deleted]" || d.body === "[removed]") continue;
      const replies =
        d.replies && typeof d.replies === "object" && d.replies.data
          ? await walkComments(postId, d.replies.data.children)
          : [];
      out.push({
        id: d.id,
        parent_id: d.parent_id,
        author: d.author,
        body: d.body,
        score: d.score,
        created_utc: d.created_utc,
        replies,
      });
    }
  }
  return out;
}

async function resolveMoreChildren(
  postId: string,
  childIds: string[]
): Promise<Comment[]> {
  const out: Comment[] = [];
  // morechildren accepts max 100 ids per call
  for (let i = 0; i < childIds.length; i += 100) {
    const batch = childIds.slice(i, i + 100);
    const data = await redditGet<any>("/api/morechildren", {
      api_type: "json",
      link_id: `t3_${postId}`,
      children: batch.join(","),
    });
    const things: any[] = data?.json?.data?.things ?? [];
    for (const t of things) {
      if (t.kind !== "t1") continue;
      const d = t.data;
      if (!d.body || d.body === "[deleted]" || d.body === "[removed]") continue;
      out.push({
        id: d.id,
        parent_id: d.parent_id,
        author: d.author,
        body: d.body,
        score: d.score,
        created_utc: d.created_utc,
        replies: [],
      });
    }
  }
  return out;
}

// ---- persistence -------------------------------------------------------------

const CORPUS_ROOT = path.resolve("data/reddit-corpus");
const RUN_STAMP = new Date().toISOString().slice(0, 10);

type IndexEntry = { id: string; subreddit: string; fetchedAt: string };

function runDir(): string {
  const dir = path.join(CORPUS_ROOT, RUN_STAMP);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(): string {
  return path.join(CORPUS_ROOT, "index.json");
}

function readIndex(): Record<string, IndexEntry> {
  try {
    return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeIndex(idx: Record<string, IndexEntry>) {
  fs.mkdirSync(CORPUS_ROOT, { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2));
}

function savePost(post: Post, comments: Comment[]) {
  const outDir = runDir();
  const record = { post, comments, fetchedAt: Date.now() };
  fs.writeFileSync(
    path.join(outDir, `${post.id}.json`),
    JSON.stringify(record, null, 2)
  );
}

// ---- modes ------------------------------------------------------------------

async function modeTest() {
  console.log("TEST: 5 posts for 'gabapentin' in r/ChronicPain (week)");
  const posts = await searchInSub("ChronicPain", "gabapentin", "new", "week", 5);
  console.log(`Found ${posts.length} posts`);

  const index = readIndex();
  for (const post of posts) {
    if (index[post.id]) {
      console.log(`  skip ${post.id} (already fetched)`);
      continue;
    }
    console.log(`  fetching ${post.id}: ${post.title.slice(0, 60)}...`);
    const comments = await fetchComments(post.subreddit, post.id);
    savePost(post, comments);
    index[post.id] = {
      id: post.id,
      subreddit: post.subreddit,
      fetchedAt: new Date().toISOString(),
    };
    writeIndex(index);
    console.log(`    → ${countAllComments(comments)} comments`);
  }
  console.log("Done. Output under data/reddit-corpus/" + RUN_STAMP + "/");
}

async function modeBootstrap() {
  const keywords = allActiveKeywords();
  const subs = targetSubreddits;
  console.log(
    `BOOTSTRAP: ${keywords.length} keywords × multiple queries + ${subs.length} subs full-browse`
  );

  const discovered = new Map<string, Post>();

  // Per-subreddit browse: new + top/year
  for (const sub of subs) {
    try {
      console.log(`browsing r/${sub} new`);
      (await browseSub(sub, "new", undefined, 100)).forEach((p) =>
        discovered.set(p.id, p)
      );
      console.log(`browsing r/${sub} top/year`);
      (await browseSub(sub, "top", "year", 100)).forEach((p) =>
        discovered.set(p.id, p)
      );
    } catch (e) {
      console.warn(`r/${sub} browse failed: ${(e as Error).message}`);
    }
  }

  // Per-keyword: site-wide + each target sub, multiple sort/time combos
  const searchMatrix: Array<["new" | "top" | "relevance", "year" | "month"]> = [
    ["top", "year"],
    ["new", "year"],
    ["top", "month"],
  ];
  for (const keyword of keywords) {
    for (const [sort, t] of searchMatrix) {
      try {
        (await searchSiteWide(keyword, sort, t, 100)).forEach((p) =>
          discovered.set(p.id, p)
        );
      } catch (e) {
        console.warn(
          `search "${keyword}" ${sort}/${t} failed: ${(e as Error).message}`
        );
      }
    }
  }

  console.log(`discovered ${discovered.size} unique posts; fetching comments...`);
  await fetchAndSave([...discovered.values()]);
}

async function modeIncremental() {
  const keywords = allActiveKeywords();
  const subs = targetSubreddits;
  const cutoff = Date.now() / 1000 - 14 * 86_400;
  console.log(
    `INCREMENTAL: new posts since ${new Date(cutoff * 1000).toISOString()}`
  );

  const discovered = new Map<string, Post>();

  // Per-subreddit new + recent top
  for (const sub of subs) {
    try {
      const newPosts = await browseSub(sub, "new", undefined, 100);
      newPosts.forEach((p) => {
        if (p.created_utc >= cutoff) discovered.set(p.id, p);
      });
      const topWeek = await browseSub(sub, "top", "week", 100);
      topWeek.forEach((p) => {
        if (p.created_utc >= cutoff) discovered.set(p.id, p);
      });
    } catch (e) {
      console.warn(`r/${sub}: ${(e as Error).message}`);
    }
  }

  // Per-keyword site-wide new/past week
  for (const keyword of keywords) {
    try {
      const posts = await searchSiteWide(keyword, "new", "week", 100);
      posts.forEach((p) => {
        if (p.created_utc >= cutoff) discovered.set(p.id, p);
      });
    } catch (e) {
      console.warn(`search "${keyword}": ${(e as Error).message}`);
    }
  }

  console.log(`discovered ${discovered.size} new posts`);

  // Also re-fetch comments on posts from last 60 days (late discussions)
  const index = readIndex();
  const cutoff60 = Date.now() / 1000 - 60 * 86_400;
  let refetched = 0;
  for (const entry of Object.values(index)) {
    // Skip if we don't have the post metadata saved; walk the corpus is optional
    // Re-fetching uses the existing subreddit name
    const filePath = findPostFile(entry.id);
    if (!filePath) continue;
    try {
      const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (record.post?.created_utc >= cutoff60) {
        discovered.set(record.post.id, record.post);
        refetched++;
      }
    } catch {}
  }
  if (refetched > 0) {
    console.log(`re-queued ${refetched} posts from last 60 days for fresh comments`);
  }

  await fetchAndSave([...discovered.values()]);
}

// ---- helpers ----------------------------------------------------------------

async function fetchAndSave(posts: Post[]) {
  const index = readIndex();
  let saved = 0;
  let skipped = 0;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    try {
      console.log(
        `[${i + 1}/${posts.length}] r/${p.subreddit} ${p.id} (${p.num_comments} comments)`
      );
      const comments = await fetchComments(p.subreddit, p.id);
      savePost(p, comments);
      index[p.id] = {
        id: p.id,
        subreddit: p.subreddit,
        fetchedAt: new Date().toISOString(),
      };
      // Persist index periodically so interruption doesn't lose progress
      if (saved % 25 === 0) writeIndex(index);
      saved++;
    } catch (e) {
      skipped++;
      console.warn(`  failed: ${(e as Error).message}`);
    }
  }
  writeIndex(index);
  console.log(`Saved ${saved}, skipped ${skipped}. Run dir: data/reddit-corpus/${RUN_STAMP}`);
}

function countAllComments(comments: Comment[]): number {
  let n = comments.length;
  for (const c of comments) n += countAllComments(c.replies);
  return n;
}

function findPostFile(postId: string): string | null {
  if (!fs.existsSync(CORPUS_ROOT)) return null;
  for (const day of fs.readdirSync(CORPUS_ROOT)) {
    const p = path.join(CORPUS_ROOT, day, `${postId}.json`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- entry ------------------------------------------------------------------

async function main() {
  const mode = process.argv[2] ?? "--test";
  switch (mode) {
    case "--test":
      await modeTest();
      break;
    case "--bootstrap":
      await modeBootstrap();
      break;
    case "--incremental":
      await modeIncremental();
      break;
    default:
      console.error(`Unknown mode: ${mode}. Use --test | --bootstrap | --incremental`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

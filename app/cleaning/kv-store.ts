import { createClient, VercelKV } from "@vercel/kv";
import { promises as fs } from "fs";
import path from "path";
import { EMPTY_GLOBAL, EMPTY_WEEK, GlobalState, WeekState } from "./state";

const KV_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  "";
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";

const isKVConfigured = Boolean(KV_URL && KV_TOKEN);

let kvClient: VercelKV | null = null;
function getKV(): VercelKV {
  if (!kvClient) {
    kvClient = createClient({ url: KV_URL, token: KV_TOKEN });
  }
  return kvClient;
}

const FALLBACK_FILE = path.join(process.cwd(), "data", "cleaning-state.json");

type FallbackShape = {
  global: GlobalState;
  weeks: Record<string, WeekState>;
};

async function readFallback(): Promise<FallbackShape> {
  try {
    const raw = await fs.readFile(FALLBACK_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { global: EMPTY_GLOBAL, weeks: {} };
  }
}

async function writeFallback(data: FallbackShape) {
  await fs.mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(data, null, 2));
}

const GLOBAL_KEY = "cleaning:global";
const weekKey = (mondayISO: string) => `cleaning:week:${mondayISO}`;

export async function getGlobal(): Promise<GlobalState> {
  if (isKVConfigured) {
    const v = await getKV().get<GlobalState>(GLOBAL_KEY);
    return v ?? EMPTY_GLOBAL;
  }
  const data = await readFallback();
  return data.global;
}

export async function setGlobal(g: GlobalState): Promise<void> {
  if (isKVConfigured) {
    await getKV().set(GLOBAL_KEY, g);
    return;
  }
  const data = await readFallback();
  data.global = g;
  await writeFallback(data);
}

export async function getWeek(mondayISO: string): Promise<WeekState> {
  if (isKVConfigured) {
    const v = await getKV().get<WeekState>(weekKey(mondayISO));
    return v ?? EMPTY_WEEK;
  }
  const data = await readFallback();
  return data.weeks[mondayISO] ?? EMPTY_WEEK;
}

export async function setWeek(mondayISO: string, w: WeekState): Promise<void> {
  if (isKVConfigured) {
    await getKV().set(weekKey(mondayISO), w);
    return;
  }
  const data = await readFallback();
  data.weeks[mondayISO] = w;
  await writeFallback(data);
}

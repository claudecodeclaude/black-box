import { createClient, VercelKV } from "@vercel/kv";
import { promises as fs } from "fs";
import path from "path";
import { EMPTY_STATE, TestimonialsState } from "./types";

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

const FALLBACK_FILE = path.join(process.cwd(), "data", "testimonials-state.json");
const KEY = "testimonials:state";

async function readFallback(): Promise<TestimonialsState> {
  try {
    const raw = await fs.readFile(FALLBACK_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
}

async function writeFallback(data: TestimonialsState) {
  await fs.mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(data, null, 2));
}

export async function getState(): Promise<TestimonialsState> {
  if (isKVConfigured) {
    const v = await getKV().get<TestimonialsState>(KEY);
    return v ?? EMPTY_STATE;
  }
  return readFallback();
}

export async function setState(s: TestimonialsState): Promise<void> {
  if (isKVConfigured) {
    await getKV().set(KEY, s);
    return;
  }
  await writeFallback(s);
}

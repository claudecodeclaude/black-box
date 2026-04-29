import { createClient, VercelKV } from "@vercel/kv";
import { promises as fs } from "fs";
import path from "path";
import { OFFICE_TEXTS_LIMIT, OfficeText } from "./types";

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

const FALLBACK_FILE = path.join(process.cwd(), "data", "office-texts.json");
const KEY = "office-texts:v1";

async function readFallback(): Promise<OfficeText[]> {
  try {
    const raw = await fs.readFile(FALLBACK_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeFallback(list: OfficeText[]): Promise<void> {
  await fs.mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(list, null, 2));
}

export async function listTexts(): Promise<OfficeText[]> {
  if (isKVConfigured) {
    return (await getKV().get<OfficeText[]>(KEY)) ?? [];
  }
  return readFallback();
}

async function saveTexts(list: OfficeText[]): Promise<void> {
  const trimmed = list.slice(0, OFFICE_TEXTS_LIMIT);
  if (isKVConfigured) {
    await getKV().set(KEY, trimmed);
    return;
  }
  await writeFallback(trimmed);
}

export async function addText(t: OfficeText): Promise<OfficeText[]> {
  const list = await listTexts();
  if (list.some((x) => x.id === t.id)) return list;
  const next = [t, ...list];
  await saveTexts(next);
  return next;
}

export async function markRead(id: string, read: boolean): Promise<OfficeText | null> {
  const list = await listTexts();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const updated = { ...list[idx], read };
  const next = [...list];
  next[idx] = updated;
  await saveTexts(next);
  return updated;
}

export async function updateForwardStatus(
  id: string,
  ghlForwarded: boolean,
  ghlError?: string
): Promise<void> {
  const list = await listTexts();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...list[idx], ghlForwarded, ghlError };
  await saveTexts(next);
}

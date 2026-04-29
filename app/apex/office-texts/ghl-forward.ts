import { OfficeText } from "./types";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";

type ForwardResult =
  | { ok: true }
  | { ok: false; error: string };

export async function forwardToGHL(t: OfficeText): Promise<ForwardResult> {
  const token = process.env.GHL_API_TOKEN || "";
  const locationId = process.env.GHL_LOCATION_ID || "";
  if (!token || !locationId) {
    return { ok: false, error: "GHL not configured (GHL_API_TOKEN / GHL_LOCATION_ID missing)" };
  }

  const contactId = await upsertGHLContact(token, locationId, t.from);
  if (!contactId.ok) return contactId;

  const res = await fetch(`${GHL_API}/conversations/messages/inbound`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "SMS",
      contactId: contactId.id,
      message: t.body,
      direction: "inbound",
      altId: t.id,
      attachments: [],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `GHL message POST ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

type UpsertResult = { ok: true; id: string } | { ok: false; error: string };

async function upsertGHLContact(
  token: string,
  locationId: string,
  phone: string
): Promise<UpsertResult> {
  const res = await fetch(`${GHL_API}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locationId, phone }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `GHL contact upsert ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as { contact?: { id?: string }; id?: string };
  const id = json.contact?.id || json.id;
  if (!id) return { ok: false, error: "GHL contact upsert returned no id" };
  return { ok: true, id };
}

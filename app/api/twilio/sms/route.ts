import { NextRequest } from "next/server";
import { addText, updateForwardStatus } from "../../../apex/office-texts/kv-store";
import { forwardToGHL } from "../../../apex/office-texts/ghl-forward";
import { OfficeText } from "../../../apex/office-texts/types";
import { verifyTwilioSignature } from "../../../apex/office-texts/twilio-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const TWIML_HEADERS = { "Content-Type": "application/xml; charset=utf-8" };

function reconstructWebhookUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const url = new URL(req.url);
  return `${proto}://${host}${url.pathname}${url.search}`;
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!authToken) {
    return new Response("twilio not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;

  const signature = req.headers.get("x-twilio-signature") || "";
  const url = reconstructWebhookUrl(req);
  if (!verifyTwilioSignature(authToken, signature, url, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const id = params.MessageSid || `manual-${Date.now()}`;
  const text: OfficeText = {
    id,
    from: params.From || "",
    to: params.To || "",
    body: params.Body || "",
    receivedAt: new Date().toISOString(),
    numMedia: Number(params.NumMedia || "0"),
    read: false,
    ghlForwarded: false,
  };

  await addText(text);

  const result = await forwardToGHL(text);
  if (result.ok) {
    await updateForwardStatus(id, true);
  } else {
    await updateForwardStatus(id, false, result.error);
  }

  return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
}

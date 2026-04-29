"use client";

import { useEffect, useState } from "react";
import { Alert, HomeItem, HomeList } from "../_components/HomeTiles";
import { report } from "../apex/reddit-ads/data";
import { candidates } from "../apex/reddit-ads/keywords";

const LS_APPROVED = "reddit-ads/approved-candidates";
const LS_REJECTED = "reddit-ads/rejected-candidates";
const STALE_DAYS = 14;

const home: HomeItem[] = [
  {
    kind: "tile",
    href: "/apex/testimonials",
    name: "Testimonial Matcher",
    description: "Paste a new patient's consult notes and get the 4 testimonials that match — runs on your Mac Mini over Tailscale.",
  },
  {
    kind: "tile",
    href: "/apex/qr",
    name: "QR Generator",
    description: "Create QR codes from any text or URL, with optional logo overlay.",
  },
  {
    kind: "folder",
    name: "Unfinished Projects",
    description: "Tools that aren't ready for daily use yet.",
    items: [
      {
        kind: "tile",
        href: "/apex/reddit-ads",
        name: "Reddit Ads",
        description: "Bi-weekly Reddit topic scan for neuropathy, sciatica, and disc/back pain — with video hooks and ad ideas per topic.",
        alertId: "reddit-ads",
      },
      {
        kind: "tile",
        href: "/apex/office-texts",
        name: "Office Texts",
        description: "Inbound SMS to the office landline via Twilio, also forwarded into Go High Level. Replaces Dial My Calls.",
      },
    ],
  },
];

function useRedditAdsAlert(): Alert | undefined {
  const [alert, setAlert] = useState<Alert | undefined>(undefined);
  useEffect(() => {
    const ageDays = Math.floor(
      (Date.now() - new Date(report.generatedAt).getTime()) / 86_400_000
    );
    const stale = ageDays >= STALE_DAYS;

    let pending = candidates.length;
    try {
      const approved = JSON.parse(
        localStorage.getItem(LS_APPROVED) || "[]"
      ) as { term: string }[];
      const rejected = JSON.parse(
        localStorage.getItem(LS_REJECTED) || "[]"
      ) as string[];
      const acted = new Set([...approved.map((a) => a.term), ...rejected]);
      pending = candidates.filter((c) => !acted.has(c.term)).length;
    } catch {}

    if (stale) {
      setAlert({ label: "Update", tone: "red" });
    } else if (pending > 0) {
      setAlert({ label: `${pending} to review`, tone: "yellow" });
    } else {
      setAlert(undefined);
    }
  }, []);
  return alert;
}

export default function ApexAppHome() {
  const redditAdsAlert = useRedditAdsAlert();
  const alertsById: Record<string, Alert> = {};
  if (redditAdsAlert) alertsById["reddit-ads"] = redditAdsAlert;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Apex App
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, letterSpacing: 2 }}>
          OFFICE & BUSINESS HUB
        </p>
      </div>

      <HomeList items={home} alertsById={alertsById} />
    </main>
  );
}

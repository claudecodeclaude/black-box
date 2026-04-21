import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cleaning",
  description: "Rotating 5-week cleaning checklist.",
  appleWebApp: {
    capable: true,
    title: "Cleaning",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function CleaningLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

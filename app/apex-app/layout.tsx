import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apex App",
  description: "Office & business hub.",
  appleWebApp: {
    capable: true,
    title: "Apex App",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function ApexAppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

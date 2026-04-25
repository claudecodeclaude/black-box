"use client";

import { useEffect, useRef } from "react";

const POLL_MS = 10_000;
const RELOAD_GUARD_KEY = "autoReload:lastReloadTo";

export default function AutoReload() {
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    const bundleVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || "dev";
    let bootApiVersion: string | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchVersion(): Promise<string | null> {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.version === "string" ? data.version : null;
      } catch {
        return null;
      }
    }

    function reloadOnceFor(target: string) {
      try {
        const last = sessionStorage.getItem(RELOAD_GUARD_KEY);
        if (last === target) return; // already tried; don't loop
        sessionStorage.setItem(RELOAD_GUARD_KEY, target);
      } catch {}
      window.location.reload();
    }

    async function maybeReload() {
      const latest = await fetchVersion();
      if (!latest) return;
      // First check on cold open: compare against the bundle's baked-in
      // version. Reloads if iOS handed us cached JS.
      if (bootApiVersion === null) {
        bootApiVersion = latest;
        if (bundleVersion !== "dev" && latest !== bundleVersion) {
          reloadOnceFor(latest);
        }
        return;
      }
      // Subsequent checks: a deploy happened while the page was open.
      if (latest !== bootApiVersion) {
        reloadOnceFor(latest);
      }
    }

    // Initial check immediately on mount — no waiting.
    maybeReload();

    interval = setInterval(() => {
      if (document.hidden) return;
      maybeReload();
    }, POLL_MS);

    const onVisibility = () => {
      if (!document.hidden) maybeReload();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // iOS bfcache restore — page was kept in memory; force a fresh load.
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}

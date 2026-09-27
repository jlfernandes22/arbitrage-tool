// Client-side desktop notification helpers for scan completion.
// Notifications fire ONLY when the tab is hidden (document.hidden) — when the
// user is watching the page, the existing toast is enough. Permission is
// requested lazily when the user enables the toggle (browsers require a user
// gesture for Notification.requestPermission in most cases).

export type NotifyPreference = "on" | "off";

const PREF_KEY = "arbitrage_notify_preference";

export function getNotifyPreference(): NotifyPreference {
  if (typeof window === "undefined") return "off";
  try {
    return (localStorage.getItem(PREF_KEY) as NotifyPreference) ?? "off";
  } catch {
    return "off";
  }
}

export function setNotifyPreference(pref: NotifyPreference): void {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    // private mode / storage disabled — preference just won't persist
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Enable desktop notifications. Requests browser permission if needed.
 * Returns the resulting permission state so the UI can explain a denial.
 */
export async function enableNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Fire a desktop notification for a finished scan. Silently no-ops when
 * notifications are unsupported / not granted / the tab is visible.
 */
export function notifyScanFinished(opts: {
  query: string;
  viable: number;
  total: number;
  bestProfit?: number;
}): void {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return; // user is watching — toast suffices
  const viableText =
    opts.viable > 0
      ? `${opts.viable} viable lead${opts.viable === 1 ? "" : "s"}`
      : "no viable leads";
  const profit =
    opts.bestProfit && opts.bestProfit > 0
      ? ` · best €${Math.round(opts.bestProfit)}`
      : "";
  try {
    const n = new Notification("Scan complete: " + opts.query, {
      body: `${viableText} of ${opts.total} listings${profit}`,
      tag: "arbitrage-scan-done", // replace stale notifications
      // icon omitted — Next.js serves /favicon.ico by default and browsers
      // fall back to the app icon when icon is undefined.
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers (older Safari) require the SW-based constructor — ignore
  }
}

/** Notify on scan failure (also only when hidden). */
export function notifyScanFailed(query: string, error?: string | null): void {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return;
  try {
    const n = new Notification("Scan failed: " + query, {
      body: error ? error.slice(0, 120) : "The pipeline reported an error.",
      tag: "arbitrage-scan-done",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // ignore
  }
}

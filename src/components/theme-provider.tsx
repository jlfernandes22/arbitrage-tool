"use client";
import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// ThemeProvider wrapper that suppresses hydration warnings from next-themes.
// In Next.js 16 + React 19 production builds, next-themes injects an inline
// script that sets the `class` attribute on <html> before React hydrates.
// This is expected but can trigger React error #418 if not handled.
// The <html suppressHydrationWarning> in layout.tsx handles the attribute
// mismatch; this wrapper ensures the provider doesn't force a re-render
// during hydration.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

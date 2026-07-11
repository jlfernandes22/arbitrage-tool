"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  // Defer rendering until after mount to avoid SSR hydration mismatch.
  // On the server, resolvedTheme is undefined; on the client it resolves
  // to "light"/"dark" based on localStorage/system preference. Rendering
  // different icons (Sun vs Moon) during hydration triggers React error #418.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);
  const isDark = resolvedTheme === "dark";
  // Render a placeholder (Moon) until mounted so server + initial client
  // render match. After mount, show the correct icon.
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      suppressHydrationWarning
    >
      {!mounted ? <Moon className="h-4 w-4" /> : isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

"use client";
import { useEffect, useRef } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LogEntry, LogLevel } from "./types";
interface TerminalConsoleProps {
  logs: LogEntry[];
  onClear?: () => void;
  active: boolean;
}
const LEVEL_STYLES: Record<LogLevel, { color: string; bg: string; prefix: string }> = {
  INFO: { color: "text-sky-300", bg: "bg-sky-500/10", prefix: "INFO" },
  WARN: { color: "text-amber-300", bg: "bg-amber-500/10", prefix: "WARN" },
  ERROR: { color: "text-rose-400", bg: "bg-rose-500/10", prefix: "ERR " },
  SUCCESS: { color: "text-emerald-300", bg: "bg-emerald-500/10", prefix: " OK " },
};
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function TerminalConsole({ logs, onClear, active }: TerminalConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [logs.length]);
  // Count errors/warnings for the title bar summary
  const errorCount = logs.filter((l) => l.level === "ERROR").length;
  const warnCount = logs.filter((l) => l.level === "WARN").length;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950 shadow-lg shadow-slate-950/20">
      {/* Title bar — subtle gradient + traffic lights + live indicator */}
      <div className="flex items-center justify-between border-b border-slate-700/80 bg-gradient-to-r from-slate-900 to-slate-800/80 px-3 py-2">
        <div className="flex items-center gap-2">
          {/* macOS-style traffic lights */}
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/90 shadow-sm shadow-rose-500/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/90 shadow-sm shadow-amber-500/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90 shadow-sm shadow-emerald-500/30" />
          </div>
          <div className="mx-1 h-4 w-px bg-slate-700" />
          <Terminal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-medium text-slate-300">
            backend execution console
          </span>
          {active && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Error/warn summary badges */}
          {errorCount > 0 && (
            <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
              {errorCount} err
            </span>
          )}
          {warnCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              {warnCount} {warnCount === 1 ? "warning" : "warnings"}
            </span>
          )}
          <span className="text-[10px] text-slate-500 tabular-nums">
            {logs.length} lines
          </span>
          {onClear && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              onClick={onClear}
              title="Clear console"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {/* Console body */}
      <div
        ref={scrollRef}
        className="max-h-56 min-h-[120px] overflow-y-auto p-3 font-mono text-xs leading-relaxed"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#475569 #020617",
        }}
      >
        {logs.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-slate-600">
            <span className="text-xs">
              {active ? "waiting for backend output…" : "no logs yet — run a scan to see execution telemetry"}
            </span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((log, i) => {
              const style = LEVEL_STYLES[log.level];
              return (
                <div
                  key={i}
                  className={`flex gap-2 whitespace-pre-wrap break-all rounded px-1 py-0.5 transition-colors hover:bg-slate-800/40 ${style.bg}`}
                >
                  <span className="shrink-0 text-slate-600 tabular-nums">
                    {formatTime(log.ts)}
                  </span>
                  <span className={`shrink-0 font-bold ${style.color}`}>
                    [{style.prefix}]
                  </span>
                  <span className="text-slate-200">{log.msg}</span>
                </div>
              );
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

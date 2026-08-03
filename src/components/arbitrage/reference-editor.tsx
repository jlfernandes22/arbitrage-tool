"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Save, Trash2, Loader2, Edit3, Download, Upload, CheckSquare, X } from "lucide-react";
import { toast } from "sonner";
interface PriceRow {
  id: string;
  standardKey: string;
  category: string;
  new: number;
  excellent: number;
  veryGood: number;
  good: number;
  fair: number;
  updatedAt: string;
}
interface ReferenceEditorProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}
const CATEGORY_LABELS: Record<string, string> = {
  iphone: "iPhone",
  macbook: "MacBook",
  ipad: "iPad",
  ps5: "PlayStation 5",
};
export function ReferenceEditor({ open, onOpenChange }: ReferenceEditorProps) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newCategory, setNewCategory] = useState("iphone");
  const [newPrices, setNewPrices] = useState({
    new: 0,
    excellent: 0,
    veryGood: 0,
    good: 0,
    fair: 0,
  });
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/config/prices", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(`Failed to load reference prices (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      setRows(data.prices ?? []);
    } catch {
      setLoadError("Failed to load reference prices. Check the server connection.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  const saveRow = async (row: PriceRow) => {
    setSaving(row.standardKey);
    try {
      const res = await fetch("/api/config/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          standardKey: row.standardKey,
          prices: {
            new: row.new,
            excellent: row.excellent,
            veryGood: row.veryGood,
            good: row.good,
            fair: row.fair,
          },
        }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success(`Updated ${row.standardKey}`);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(null);
    }
  };
  const deleteRow = async (standardKey: string) => {
    try {
      const res = await fetch("/api/config/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", standardKey }),
      });
      if (!res.ok) throw new Error("delete failed");
      setRows((r) => r.filter((x) => x.standardKey !== standardKey));
      toast.success(`Deleted ${standardKey}`);
    } catch {
      toast.error("Failed to delete");
    }
  };
  // ── BULK DELETE ───────────────────────────────────────────────────
  // Deletes all rows whose checkbox is checked. Confirms with the user
  // before proceeding since this is destructive.
  const bulkDelete = async () => {
    const toDelete = rows.filter((r) => selectedIds.has(r.id));
    if (toDelete.length === 0) return;
    if (!window.confirm(`Delete ${toDelete.length} selected SKU${toDelete.length > 1 ? "s" : ""}? This cannot be undone.`)) {
      return;
    }
    setBulkDeleting(true);
    try {
      // Use the bulk-delete API action (single request) instead of
      // sequential per-row calls — much faster for large selections.
      const res = await fetch("/api/config/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_delete", standardKeys: toDelete.map((r) => r.standardKey) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "bulk delete failed");
      }
      const result = await res.json();
      const deleted = result.deletedCount ?? 0;
      if (deleted === toDelete.length) {
        toast.success(`Deleted ${deleted} SKU${deleted > 1 ? "s" : ""}`);
      } else {
        toast.error(`Deleted ${deleted} of ${toDelete.length} SKUs`);
      }
      setSelectedIds(new Set());
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete SKUs");
    } finally {
      setBulkDeleting(false);
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === filtered.length) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  };
  const addRow = async () => {
    if (!newKey.trim()) {
      toast.error("Standard key is required");
      return;
    }
    try {
      const res = await fetch("/api/config/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          standardKey: newKey.trim(),
          category: newCategory,
          prices: newPrices,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "create failed");
      }
      toast.success(`Added ${newKey.trim()}`);
      setNewKey("");
      setNewPrices({ new: 0, excellent: 0, veryGood: 0, good: 0, fair: 0 });
      setAdding(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  };
  const updateField = (id: string, field: keyof PriceRow, value: string | number) => {
    setRows((r) =>
      r.map((row) =>
        row.id === id ? { ...row, [field]: typeof value === "string" ? parseFloat(value) || 0 : value } : row,
      ),
    );
  };
  // ── CSV EXPORT ────────────────────────────────────────────────────
  // Exports the full reference matrix as CSV with a header row. Format:
  //   standardKey,category,new,excellent,veryGood,good,fair
  const exportCsv = () => {
    const header = "standardKey,category,new,excellent,veryGood,good,fair";
    const lines = rows.map((r) =>
      [
        csvEscape(r.standardKey),
        r.category,
        r.new,
        r.excellent,
        r.veryGood,
        r.good,
        r.fair,
      ].join(","),
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reference-prices-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows to CSV`);
  };
  const csvEscape = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  // ── CSV IMPORT ────────────────────────────────────────────────────
  // Parses a CSV file (header: standardKey,category,new,excellent,veryGood,good,fair)
  // and bulk-upserts via the API. Shows a preview toast with created/updated counts.
  const [importing, setImporting] = useState(false);
  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseReferenceCsv(text);
      if (parsed.length === 0) {
        toast.error("CSV contained no valid rows");
        return;
      }
      // ── Duplicate detection: warn if a standardKey already exists with
      // different prices. This helps admins catch accidental re-imports
      // that would overwrite carefully tuned values.
      const existingMap = new Map(rows.map((r) => [r.standardKey, r]));
      const conflicts: Array<{ key: string; field: string; oldVal: number; newVal: number }> = [];
      for (const p of parsed) {
        const existing = existingMap.get(p.standardKey);
        if (!existing) continue;
        const fields: Array<{ name: keyof typeof existing; key: string }> = [
          { name: "new", key: "new" },
          { name: "excellent", key: "excellent" },
          { name: "veryGood", key: "veryGood" },
          { name: "good", key: "good" },
          { name: "fair", key: "fair" },
        ];
        for (const f of fields) {
          const oldVal = existing[f.name] as number;
          const newVal = p.prices[f.key as keyof typeof p.prices];
          if (oldVal !== newVal) {
            conflicts.push({ key: p.standardKey, field: f.name, oldVal, newVal });
          }
        }
      }
      if (conflicts.length > 0) {
        const sample = conflicts.slice(0, 3).map((c) => `${c.key}.${c.field}: ${c.oldVal}→${c.newVal}`).join("; ");
        const proceed = window.confirm(
          `${conflicts.length} price conflict${conflicts.length > 1 ? "s" : ""} detected across ${new Set(conflicts.map((c) => c.key)).size} existing SKU(s).\n\nExamples: ${sample}${conflicts.length > 3 ? "…" : ""}\n\nProceed with import? Existing values will be overwritten.`,
        );
        if (!proceed) {
          toast.info("Import cancelled");
          return;
        }
      }
      const res = await fetch("/api/config/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_upsert", rows: parsed }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "import failed");
      }
      const result = await res.json();
      const conflictNote = conflicts.length > 0 ? ` · ${conflicts.length} conflicts overwritten` : "";
      toast.success(`Imported ${parsed.length} rows · ${result.created} created, ${result.updated} updated${conflictNote}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };
  const filtered = filter === "all" ? rows : rows.filter((r) => r.category === filter);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-shrink-0 border-b px-6 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Edit3 className="h-4 w-4" />
            Reference Price Matrix
          </DialogTitle>
          <DialogDescription className="text-xs">
            Baseline EUR resale prices per SKU &amp; condition tier. Used by the
            scam detector (price-deviation layer) and profit calculator (resale
            fallback). Changes persist to the database and apply to all future scans.
          </DialogDescription>
        </DialogHeader>
        {/* Toolbar — flex-wrap so buttons wrap to the next line instead of
            overflowing off the right edge of the dialog. */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="text-xs">
            {filtered.length} entries
          </Badge>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {selectedIds.size} selected
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950"
                onClick={bulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Delete ({selectedIds.size})</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setSelectedIds(new Set())}
                title="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={exportCsv}
              disabled={rows.length === 0}
              title="Export all reference prices as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
            <label
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              title="Import reference prices from CSV (bulk upsert)"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importCsv(f);
                  e.target.value = ""; // reset so same file can be re-selected
                }}
              />
            </label>
            <Button
              size="sm"
              className="h-8"
              onClick={() => setAdding((a) => !a)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {adding ? "Cancel" : "Add SKU"}
            </Button>
          </div>
        </div>
        {adding && (
          <div className="mx-6 grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4 lg:grid-cols-7">
            <Input
              placeholder="Standard Key (e.g. iPhone 12 128GB)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="h-8 text-xs sm:col-span-2"
            />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <NumInput label="New" value={newPrices.new} onChange={(v) => setNewPrices((p) => ({ ...p, new: v }))} />
            <NumInput label="Exc." value={newPrices.excellent} onChange={(v) => setNewPrices((p) => ({ ...p, excellent: v }))} />
            <NumInput label="V.Good" value={newPrices.veryGood} onChange={(v) => setNewPrices((p) => ({ ...p, veryGood: v }))} />
            <NumInput label="Good" value={newPrices.good} onChange={(v) => setNewPrices((p) => ({ ...p, good: v }))} />
            <div className="flex items-center gap-1">
              <NumInput label="Fair" value={newPrices.fair} onChange={(v) => setNewPrices((p) => ({ ...p, fair: v }))} />
              <Button size="sm" className="h-8" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        {/* Table container — overflow-x-auto so the 9-column table scrolls
            horizontally if it exceeds the dialog width, instead of pushing
            content off the right edge. min-w prevents columns from
            compressing too much. */}
        <div className="min-h-0 flex-1 overflow-auto border-t px-6 py-3">
          <ScrollArea className="max-h-[50vh] rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-xs text-rose-600 dark:text-rose-400">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load} className="h-7 text-xs">
                <Loader2 className="mr-1.5 h-3 w-3" />
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-10 p-2">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead className="text-xs">Standard Key</TableHead>
                  <TableHead className="text-xs">Cat.</TableHead>
                  <TableHead className="text-right text-xs">New €</TableHead>
                  <TableHead className="text-right text-xs">Excellent €</TableHead>
                  <TableHead className="text-right text-xs">V.Good €</TableHead>
                  <TableHead className="text-right text-xs">Good €</TableHead>
                  <TableHead className="text-right text-xs">Fair €</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id} className={selectedIds.has(row.id) ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                    <TableCell className="w-10 p-2">
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                        aria-label={`Select ${row.standardKey}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">
                      {row.standardKey}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {CATEGORY_LABELS[row.category] ?? row.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={row.new}
                        onChange={(e) => updateField(row.id, "new", e.target.value)}
                        className="h-7 w-16 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={row.excellent}
                        onChange={(e) => updateField(row.id, "excellent", e.target.value)}
                        className="h-7 w-16 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={row.veryGood}
                        onChange={(e) => updateField(row.id, "veryGood", e.target.value)}
                        className="h-7 w-16 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={row.good}
                        onChange={(e) => updateField(row.id, "good", e.target.value)}
                        className="h-7 w-16 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        value={row.fair}
                        onChange={(e) => updateField(row.id, "fair", e.target.value)}
                        className="h-7 w-16 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => saveRow(row)}
                          disabled={saving === row.standardKey}
                          title="Save changes"
                        >
                          {saving === row.standardKey ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-rose-600 hover:text-rose-700"
                          onClick={() => deleteRow(row.standardKey)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col">
      <Label className="text-[9px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-7 w-full text-right text-xs"
      />
    </div>
  );
}
/**
 * Parse a reference-price CSV into the bulk-upsert row shape.
 * Expected header: standardKey,category,new,excellent,veryGood,good,fair
 * - Quoted fields are handled (e.g. "iPhone 12 128GB").
 * - Rows with an empty standardKey are skipped.
 * - Non-numeric price cells default to 0.
 * - Categories are validated against the known set; unknown → "iphone".
 */
function parseReferenceCsv(
  text: string,
): Array<{
  standardKey: string;
  category: string;
  prices: { new: number; excellent: number; veryGood: number; good: number; fair: number };
}> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // header + at least 1 data row
  // Parse a single CSV line into fields, respecting quoted values.
  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") {
          fields.push(cur);
          cur = "";
        } else cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  };
  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iKey = idx("standardkey");
  const iCat = idx("category");
  const iNew = idx("new");
  const iExc = idx("excellent");
  const iVg = idx("verygood");
  const iGood = idx("good");
  const iFair = idx("fair");
  const validCats = new Set(["iphone", "macbook", "ipad", "ps5", "samsung", "applewatch", "dji", "xiaomi", "gaming"]);
  const out: Array<{
    standardKey: string;
    category: string;
    prices: { new: number; excellent: number; veryGood: number; good: number; fair: number };
  }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const standardKey = (cols[iKey] ?? "").trim();
    if (!standardKey) continue;
    const rawCat = (cols[iCat] ?? "iphone").trim().toLowerCase();
    const category = validCats.has(rawCat) ? rawCat : "iphone";
    const num = (v: string | undefined) => {
      const n = parseFloat((v ?? "0").replace(/[^0-9.\-]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    out.push({
      standardKey,
      category,
      prices: {
        new: num(cols[iNew]),
        excellent: num(cols[iExc]),
        veryGood: num(cols[iVg]),
        good: num(cols[iGood]),
        fair: num(cols[iFair]),
      },
    });
  }
  return out;
}
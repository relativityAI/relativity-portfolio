import { useEffect, useMemo, useState } from "react";
import { Wrench, Search } from "lucide-react";
import { ToolService, type ToolCatalogEntry } from "@/db";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Tools reference — read-only catalog of every tool an agent's skills can
 * call, with the server's own descriptions. Purely informative: the user
 * learns what data an agent can draw on without reading tool source code.
 */

/** Friendly label per tool name — "get_balance_sheets" → "Balance sheets". */
function labelFor(name: string): string {
    return name
        .split("_")
        .filter((w) => w !== "get" && w !== "latest")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ") || name;
}

/** Short capability tag so scanning the list is faster than reading prose. */
function tagFor(name: string): string {
    if (/financ|income|balance|cash|sharehold|announcement/.test(name)) return "Filings";
    if (/metric|macro|price|symbol/.test(name)) return "Market data";
    if (/search|reddit|youtube|news/.test(name)) return "Web & news";
    if (/transcript|presentation|pdf|document|index/.test(name)) return "Documents";
    return "Other";
}

const TAG_ORDER = ["Market data", "Filings", "Documents", "Web & news", "Other"];

export default function AgentTools() {
    const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        ToolService.getCatalog()
            .then((d) => setTools(d))
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return tools.filter(
            (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        );
    }, [tools, query]);

    const grouped = useMemo(() => {
        const groups = new Map<string, ToolCatalogEntry[]>();
        for (const t of filtered) {
            const tag = tagFor(t.name);
            if (!groups.has(tag)) groups.set(tag, []);
            groups.get(tag)!.push(t);
        }
        return TAG_ORDER.filter((tag) => groups.has(tag)).map((tag) => ({ tag, items: groups.get(tag)! }));
    }, [filtered]);

    return (
        <div className="mx-auto max-w-3xl px-8 pt-7 pb-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-console-ink">
                        <Wrench className="size-5 text-console-accent" />
                        Agent Tools
                    </h1>
                    <p className="mt-0.5 text-[13px] text-console-ink-2">
                        Every data source an agent's skills can call — read-only reference.
                    </p>
                </div>
            </div>

            <div className="relative mt-5">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                <Input
                    className="pl-9"
                    placeholder="Search tools…"
                    aria-label="Search tools"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="mt-5 space-y-2" role="status" aria-label="Loading tools">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-14 animate-pulse rounded-xl bg-console-recessed" />
                    ))}
                </div>
            ) : error ? (
                <p className="mt-5 text-[13px] text-console-negative">
                    The tool catalog could not be loaded. Reload to retry.
                </p>
            ) : (
                <div className="mt-5 flex flex-col gap-6">
                    {grouped.map(({ tag, items }) => (
                        <section key={tag}>
                            <p className="mb-2 text-[10px] font-medium tracking-wide text-console-ink-4">
                                {tag} · {items.length}
                            </p>
                            <div className="flex flex-col gap-1.5">
                                {items.map((t) => (
                                    <ToolRow key={t.name} tool={t} />
                                ))}
                            </div>
                        </section>
                    ))}
                    {filtered.length === 0 && (
                        <p className="py-4 text-[13px] text-console-ink-3">No tools match that search.</p>
                    )}
                </div>
            )}
        </div>
    );
}

function ToolRow({ tool }: { tool: ToolCatalogEntry }) {
    const [open, setOpen] = useState(false);
    return (
        <div
            className={cn(
                "rounded-2xl bg-console-recessed/50 px-4 py-3 transition-colors",
                open && "bg-console-recessed",
            )}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40 rounded-lg"
            >
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-console-ink">{labelFor(tool.name)}</span>
                    <span className="block truncate font-mono text-[10.5px] text-console-ink-4">{tool.name}</span>
                </span>
                <span
                    className={cn(
                        "text-[11px] text-console-ink-4 transition-transform duration-150",
                        open && "rotate-90",
                    )}
                    aria-hidden
                >
                    ›
                </span>
            </button>
            {open && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-console-ink-2">
                    {tool.description || "No description available."}
                </p>
            )}
        </div>
    );
}

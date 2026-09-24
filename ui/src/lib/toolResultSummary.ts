/**
 * Condense a Voyager tool result into a short human-readable line for the UI
 * (agent activity row / qual tool-call disclosure). Tailored to the tool
 * output shapes in api/src/tools.ts; anything unrecognized falls back to the
 * most informative scalars instead of a raw JSON blob.
 */

const ARRAY_KEYS = ["announcements", "matches", "stories", "results", "posts", "videos", "news", "data", "items"];

function fmtNum(v: number): string {
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
}

function itemSummary(item: unknown): string {
    if (typeof item === "string") return item.slice(0, 120);
    if (item == null || typeof item !== "object") return "";
    const o = item as Record<string, unknown>;
    const out: string[] = [];
    const labels = ["title", "heading", "name", "company_name", "symbol", "label", "metric_name", "subreddit"];
    for (const k of labels) {
        if (typeof o[k] === "string" && (o[k] as string).trim()) {
            out.push(String(o[k]));
            break;
        }
    }
    const extras = ["date", "category", "channel_name", "channel", "published_at", "publish_time", "author", "source"];
    for (const k of extras) {
        if (out.length >= 3) break;
        if (typeof o[k] === "string" && (o[k] as string).trim() && !/id$/i.test(k)) out.push(String(o[k]));
    }
    for (const [k, v] of Object.entries(o)) {
        if (out.length >= 4) break;
        if (typeof v === "number" && !/id$/i.test(k)) out.push(`${k}: ${fmtNum(v)}`);
    }
    return out.join(" · ");
}

function arraySummary(items: unknown[]): string {
    if (items.length === 0) return "(empty)";
    const head = items.slice(0, 3).map(itemSummary).filter(Boolean).join("; ");
    const more = items.length > 3 ? ` +${items.length - 3} more` : "";
    return `${head}${more}`;
}

function compactScalars(o: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(o)) {
        if (v == null || typeof v === "object" || typeof v === "boolean") continue;
        if (/^id$|_id$|^uuid$|created_at|updated_at|last_pull|^url$/.test(k)) continue;
        if (typeof v === "number") parts.push(`${k}: ${fmtNum(v)}`);
        else {
            const s = String(v);
            if (!s.trim() || s.length > 60) continue;
            parts.push(`${k}: ${s}`);
        }
        if (parts.length >= 8) break;
    }
    return parts.join("  ") || "";
}

export function summarizeToolResult(result: unknown): string {
    if (result == null) return "";
    if (typeof result === "string") return result.length > 300 ? `text (${result.length.toLocaleString()} chars)` : result;
    if (typeof result !== "object") return String(result);
    if (Array.isArray(result)) return arraySummary(result);

    const o = result as Record<string, unknown>;

    if (typeof o.text === "string" && o.text.length > 300) {
        return `text (${o.text.length.toLocaleString()} chars)${o.url ? ` · ${String(o.url)}` : ""}`;
    }
    for (const key of ARRAY_KEYS) {
        if (Array.isArray(o[key]) && (o[key] as unknown[]).length > 0) {
            return arraySummary(o[key] as unknown[]);
        }
    }
    if (typeof o.status === "string" && ("job_id" in o || "result" in o)) {
        return typeof o.result === "object" && o.result !== null
            ? `status ${o.status} · ${compactScalars(o.result as Record<string, unknown>)}`
            : `status ${o.status}`;
    }
    if (typeof o.message === "string" && Object.keys(o).length <= 2) return o.message;

    return compactScalars(o) || "(no data)";
}
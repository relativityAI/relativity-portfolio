import { useEffect, useState } from "react";
import {
    BarChart3, CalendarClock,
    DollarSign, FileSearch, FileText, Globe, Landmark, ListTree,
    Newspaper, PieChart, Presentation, Receipt, Search,
    TrendingUp, Users, Video, type LucideIcon,
} from "lucide-react";
import {
    ToolTimeline,
    type TimelineStat,
    type TimelineStep,
} from "@/components/assistant-ui/elements/tool-timeline";
import type { TraceEvent } from "@/pages/shared/TracePanel";
import { summarizeToolResult } from "@/lib/toolResultSummary";
import { cn } from "@/lib/utils";

/**
 * Timeline of an agent run's tool activity, built on the official
 * assistant-ui ToolTimeline element. One step per tool call, verb + chip
 * derived from the tool name; stats show data volumes when the result is
 * summarizable. Works for the live builder chat (SSE events) and the
 * persisted analysis run view (analysis.trace).
 */

const TOOL_META: Record<string, { verb: string; icon: LucideIcon }> = {
    get_financial_metrics: { verb: "Reading", icon: PieChart },
    compare_financial_metrics: { verb: "Comparing", icon: BarChart3 },
    search_symbol: { verb: "Looking up", icon: Search },
    get_financials: { verb: "Reading", icon: Receipt },
    get_income_statements: { verb: "Reading", icon: Receipt },
    get_balance_sheets: { verb: "Reading", icon: Landmark },
    get_cash_flows: { verb: "Reading", icon: DollarSign },
    get_announcements: { verb: "Checking", icon: CalendarClock },
    get_shareholdings: { verb: "Reading", icon: Users },
    list_categories: { verb: "Browsing", icon: ListTree },
    search_company_documents: { verb: "Searching", icon: FileSearch },
    read_latest_transcript: { verb: "Reading", icon: FileText },
    read_latest_presentation: { verb: "Reading", icon: Presentation },
    read_pdf: { verb: "Reading", icon: FileText },
    parse_pdf_document: { verb: "Extracting", icon: FileText },
    get_document_index: { verb: "Browsing", icon: ListTree },
    search_news: { verb: "Searching", icon: Newspaper },
    get_market_news: { verb: "Checking", icon: Newspaper },
    get_ticker_news: { verb: "Checking", icon: Newspaper },
    search_reddit: { verb: "Searching", icon: Globe },
    search_youtube: { verb: "Searching", icon: Video },
    get_youtube_transcript: { verb: "Reading", icon: Video },
    get_current_price: { verb: "Checking", icon: TrendingUp },
    get_price_history: { verb: "Pulling", icon: TrendingUp },
    get_macro_snapshot: { verb: "Checking", icon: Globe },
    web_search: { verb: "Searching", icon: Globe },
};

const FALLBACK_META = { verb: "Calling", icon: FileSearch };

/** Args chip: symbol/query/filing-type — the identity of the call, not the dump. */
function chipFor(tool: string, args: unknown): string {
    if (args && typeof args === "object" && !Array.isArray(args)) {
        const o = args as Record<string, unknown>;
        const pick = ["symbol", "symbols", "query", "share_name", "fields", "filing_type", "source"];
        for (const k of pick) {
            const v = o[k];
            if (typeof v === "string" && v) return v.length > 28 ? `${v.slice(0, 27)}…` : v;
            if (Array.isArray(v) && v.length) return v.slice(0, 3).join(", ") + (v.length > 3 ? ` +${v.length - 3}` : "");
        }
    }
    return tool;
}

export function deriveTimelineSteps(events: TraceEvent[]): TimelineStep[] {
    const steps: TimelineStep[] = [];
    for (const ev of events) {
        if (ev.type !== "tool_call") continue;
        const meta = TOOL_META[ev.tool || ""] || FALLBACK_META;
        steps.push({
            verb: meta.verb,
            chip: chipFor(ev.tool, ev.args),
            icon: meta.icon,
        });
    }
    return steps;
}

/** Data-volume stats from tool results that carry one (counts, totals). */
export function deriveTimelineStats(events: TraceEvent[]): TimelineStat[] {
    const stats: TimelineStat[] = [];
    for (const ev of events) {
        if (ev.type !== "tool_result" || ev.status === "ERR") continue;
        const summary = summarizeToolResult(ev.result);
        if (!summary) continue;
        // Compact chip: first number-ish token the summary surfaces.
        const m = summary.match(/\d[\d,.]*\s*\+?\s*(results?|rows?|docs?|items?|pages?|sources?)/i);
        if (m) {
            stats.push({ file: `${ev.tool}:`, added: undefined, removed: undefined });
            stats[stats.length - 1] = { file: m[0].replace(/\s+/g, " ") };
        }
    }
    return stats.slice(0, 4);
}

export interface RunToolTimelineProps {
    events: TraceEvent[];
    /** Show the shimmer/streaming state while the run is live. */
    streaming?: boolean;
    className?: string;
}

export function RunToolTimeline({ events, streaming = false, className }: RunToolTimelineProps) {
    const steps = deriveTimelineSteps(events);
    const stats = deriveTimelineStats(events);
    const [open, setOpen] = useState(false);

    // Auto-open while streaming so users see progress; collapse on finish.
    useEffect(() => {
        if (streaming) setOpen(true);
    }, [streaming]);

    if (steps.length === 0 && !streaming) return null;

    const visible = Math.min(8, Math.max(4, steps.length));

    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <ToolTimeline
                steps={steps}
                visibleSteps={visible}
                streaming={streaming}
                open={open}
                onOpenChange={setOpen}
                restingLabel={steps.length ? `${steps.length} tool call${steps.length === 1 ? "" : "s"}` : "Working…"}
                activeLabel={steps.length ? `${steps.length} tool call${steps.length === 1 ? "" : "s"} so far` : "Working…"}
                stats={stats}
            />
        </div>
    );
}

export default RunToolTimeline;

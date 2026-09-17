import { LuNewspaper, LuGlobe } from "react-icons/lu";
import type { IconType } from "react-icons";
import secLogo from "@/assets/sec_logo.png";
import nseLogo from "@/assets/nse_logo.png";
import voyagerLogo from "@/assets/voyager_logo.png";
import youtubeLogo from "@/assets/youtube_logo.png";
import redditLogo from "@/assets/reddit_logo.png";

export type SourceKey = "sec" | "nse" | "voyager" | "youtube" | "reddit" | "news" | "web";

type SourceDef = { image?: string; icon?: IconType; label: string; full: string };

export const SOURCE_DEFS: Record<SourceKey, SourceDef> = {
    sec: { image: secLogo, label: "SEC", full: "U.S. Securities & Exchange Commission" },
    nse: { image: nseLogo, label: "NSE", full: "National Stock Exchange of India" },
    voyager: { image: voyagerLogo, label: "Voyager", full: "Voyager data engine" },
    youtube: { image: youtubeLogo, label: "YouTube", full: "YouTube" },
    reddit: { image: redditLogo, label: "Reddit", full: "Reddit" },
    news: { icon: LuNewspaper, label: "News", full: "Market & ticker news" },
    web: { icon: LuGlobe, label: "Web", full: "Live web search" },
};

export function SourceMark({ source, size = 12, muted = false }: { source: SourceKey; size?: number; muted?: boolean }) {
    const def = SOURCE_DEFS[source];
    if (def.image) {
        return (
            <img
                src={def.image}
                alt=""
                aria-hidden="true"
                title={def.full}
                height={size}
                style={{
                    height: size,
                    width: "auto",
                    objectFit: "contain",
                    display: "inline-block",
                    filter: muted ? "grayscale(1)" : undefined,
                    opacity: muted ? 0.7 : 1,
                }}
            />
        );
    }
    const Icon = def.icon!;
    return <Icon size={size} title={def.full} aria-label={def.full} style={{ color: "var(--ink-tertiary)", flexShrink: 0 }} />;
}

// Maps an agent tool name to the real data sources it pulls from. "exchange"
// is a placeholder resolved to the run's exchange (SEC or NSE) at render time.
const TOOL_SOURCES: Record<string, SourceKey[]> = {
    get_financial_metrics: ["exchange", "voyager"],
    get_financials: ["exchange", "voyager"],
    get_income_statements: ["exchange", "voyager"],
    get_balance_sheets: ["exchange", "voyager"],
    get_cash_flows: ["exchange", "voyager"],
    get_announcements: ["exchange", "voyager"],
    search_company_documents: ["exchange", "voyager"],
    read_latest_transcript: ["exchange", "voyager"],
    read_latest_presentation: ["exchange", "voyager"],
    read_pdf: ["exchange", "voyager"],
    parse_pdf_document: ["exchange", "voyager"],
    get_document_index: ["exchange", "voyager"],
    get_shareholdings: ["exchange", "voyager"],
    analyze_management_sentiment: ["voyager"],
    get_dcf_valuation: ["exchange", "voyager"],
    get_pull_status: ["exchange", "voyager"],
    trigger_data_pull: ["exchange", "voyager"],
    get_pull_job_status: ["voyager"],
    list_pull_jobs: ["voyager"],
    list_categories: ["exchange", "voyager"],
    get_market_news: ["news"],
    get_ticker_news: ["news"],
    search_reddit: ["reddit"],
    search_youtube: ["youtube"],
    get_youtube_transcript: ["youtube"],
    web_search: ["web"],
};

// Unique, ordered list of sources really used by a parameter's tool calls.
export function sourcesUsedForParam(calls: { tool_name?: string }[] | undefined): SourceKey[] {
    const out: SourceKey[] = [];
    for (const c of calls || []) {
        for (const k of TOOL_SOURCES[String(c?.tool_name || "")] || []) {
            if (!out.includes(k)) out.push(k);
        }
    }
    return out;
}
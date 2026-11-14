/** Relativity's built-in default agents — the cards on the home page and the
 *  targets of /agent/:id. `activeDefaultAgentIds` is the localStorage-backed
 *  set the Agents workspace toggles; the home page filters its grids on it. */

export interface DefaultAgent {
    /** URL slug for /agent/:id */
    id: string;
    name: string;
    /** DiceBear seed — matches the home-page card avatar. */
    seed: string;
    when: string;
    group: "market" | "sector";
    /** Big hero word on the agent page. */
    headline: string;
    tone: "positive" | "caution" | "negative";
    summary: string;
}

export const DEFAULT_AGENTS: DefaultAgent[] = [
    { id: "indian-indices-sentiment", name: "Indian Indices Sentiment Agent", seed: "momentum-agent", when: "Today, 09:45", group: "market", headline: "Momentum", tone: "positive", summary: "Nifty 50 shows strong upward momentum with rising volume." },
    { id: "indian-investor-sentiment", name: "Indian Investor Sentiment Agent", seed: "value-agent", when: "Today, 09:42", group: "market", headline: "Stretched", tone: "caution", summary: "Current valuations are stretched relative to historical averages." },
    { id: "nifty-bank", name: "Nifty Bank Agent", seed: "bank-agent", when: "Today, 09:40", group: "sector", headline: "Firm", tone: "positive", summary: "Bank index credit growth intact; margin pressure easing." },
];

const STORAGE_KEY = "relativity.active-default-agents";

/** Every default agent active until the user toggles some off. */
export function activeDefaultAgentIds(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return new Set(parsed.filter((x): x is string => typeof x === "string"));
            }
        }
    } catch {
        // corrupt storage or no DOM — fall through to "all active"
    }
    return new Set(DEFAULT_AGENTS.map((a) => a.id));
}

export function saveActiveDefaultAgentIds(ids: Set<string>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
        // storage unavailable — toggle still works for this session
    }
}

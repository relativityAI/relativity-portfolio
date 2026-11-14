/** Agent tags — comma-separated chips. Local until the API grows a `tags`
 *  field; keyed by agent id so two agents never share a list. */

const TAGS_KEY = "relativity.agent-tags";

export function tagsFor(id: string): string[] {
    try {
        const raw = localStorage.getItem(TAGS_KEY);
        if (raw) {
            const map: unknown = JSON.parse(raw);
            const list = map && typeof map === "object" ? (map as Record<string, unknown>)[id] : undefined;
            if (Array.isArray(list)) return list.filter((x): x is string => typeof x === "string");
        }
    } catch { /* corrupt storage → no tags */ }
    return [];
}

export function putTags(id: string, tags: string[]): void {
    try {
        const raw = localStorage.getItem(TAGS_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[id] = tags;
        localStorage.setItem(TAGS_KEY, JSON.stringify(map));
    } catch { /* session-only */ }
}

/** Text still in the box counts as one more tag the moment anything saves. */
export function finalTags(tags: string[], pending: string): string[] {
    const t = pending.trim();
    return t ? [...tags, t] : tags;
}

/** Typing a comma turns what's before it into a chip; the rest stays typed. */
export function applyComma(tags: string[], typed: string): { tags: string[]; text: string } {
    if (!typed.includes(",")) return { tags, text: typed };
    const [head, ...rest] = typed.split(",");
    const t = head.trim();
    return { tags: t ? [...tags, t] : tags, text: rest.join(",").replace(/^[\s,]+/, "") };
}

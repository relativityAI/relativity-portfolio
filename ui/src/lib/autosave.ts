import { useEffect, useState } from "react";

// Local draft recovery for the agent editor. Debounced writes keyed by agent id
// (or a draft UUID for new agents) so a refresh / backgrounded tab never loses
// work. "Saved" still means "on the server" — this is only a recovery net.

const PREFIX = "rel:agentdraft:";

export interface LocalDraft<T> {
    savedAt: number;
    data: T;
}

export function draftKey(id: string): string {
    return `${PREFIX}${id}`;
}

export function saveLocalDraft<T>(key: string, data: T): number {
    const now = Date.now();
    try {
        localStorage.setItem(key, JSON.stringify({ savedAt: now, data } satisfies LocalDraft<T>));
    } catch {
        // storage full / unavailable — recovery is best-effort
    }
    return now;
}

export function loadLocalDraft<T>(key: string): LocalDraft<T> | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as LocalDraft<T>;
        if (!parsed || typeof parsed.savedAt !== "number" || !parsed.data) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearLocalDraft(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // ignore
    }
}

export const DRAFT_DEBOUNCE_MS = 1000;

/**
 * Debounced writes to localStorage. `key` undefined disables the hook entirely
 * (e.g. direct input control). Returns the timestamp of the latest write, or
 * null if nothing has been persisted yet.
 */
export function useLocalAutosave<T>(key: string | undefined, data: T, enabled: boolean): number | null {
    const [savedAt, setSavedAt] = useState<number | null>(null);
    useEffect(() => {
        if (!key || !enabled) return;
        const t = setTimeout(() => {
            setSavedAt(saveLocalDraft(key, data));
        }, DRAFT_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [key, data, enabled]);
    return savedAt;
}
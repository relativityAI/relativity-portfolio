import { X } from "lucide-react";
import { applyComma } from "@/lib/agentTags";

/** Comma-separated tags as chips: comma/Enter commits, X or backspace drops. */
export default function TagInput({ value, text, onText, onTags, className }: {
    value: string[];
    text: string;
    onText: (v: string) => void;
    onTags: (v: string[]) => void;
    className?: string;
}) {
    const commit = () => {
        const t = text.trim();
        if (t) onTags([...value, t]);
        onText("");
    };
    return (
        <div className={className || "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 py-1.5 focus-within:ring-1 focus-within:ring-console-accent/40"}>
            {value.map((t, i) => (
                <span
                    key={`${t}-${i}`}
                    className="inline-flex items-center gap-1 rounded-[4px] bg-console-recessed px-1.5 py-0.5 font-app-body text-[12px] text-console-ink-2"
                >
                    {t}
                    <button
                        type="button"
                        aria-label={`Remove tag ${t}`}
                        onClick={() => onTags(value.filter((_, j) => j !== i))}
                        className="text-console-ink-4 transition hover:text-console-ink"
                    >
                        <X className="size-3" />
                    </button>
                </span>
            ))}
            <input
                value={text}
                onChange={(e) => {
                    const v = e.target.value;
                    if (!v.includes(",")) return onText(v);
                    const next = applyComma(value, v);
                    onTags(next.tags);
                    onText(next.text);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Backspace" && !text && value.length) onTags(value.slice(0, -1));
                    else if (e.key === "Enter" || e.key === "Escape") commit();
                }}
                onBlur={commit}
                placeholder={value.length || text ? "" : "tag1, tag2"}
                aria-label="Tags"
                className="min-w-20 flex-1 bg-transparent py-0.5 font-app-body text-[13px] text-console-ink outline-none placeholder:text-console-ink-4"
            />
        </div>
    );
}

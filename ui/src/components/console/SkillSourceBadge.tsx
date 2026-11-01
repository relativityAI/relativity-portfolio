/**
 * Provenance tag for a skill. Only "Custom" (the user's own creation) is
 * labelled — built-ins are the default and need no tag.
 */
export function SkillSourceBadge({
    source,
    className,
}: {
    source: "builtin" | "custom" | undefined;
    className?: string;
}) {
    if (source !== "custom") return null;
    return (
        <span
            className={
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-console-recessed px-2 py-0.5 text-[10px] font-medium text-console-ink-2 " +
                (className || "")
            }
            title="Your own skill — edits apply everywhere it's used"
        >
            Custom
        </span>
    );
}

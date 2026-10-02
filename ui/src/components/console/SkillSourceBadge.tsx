import { useColorModeValue } from "@/compat/ui";
import logoLight from "@/assets/logo-light.png";
import logoDark from "@/assets/logo-dark.png";

/**
 * Provenance tag for a skill: "Built-in" (shipped with Relativity — carries
 * the Relativity mark) vs "Custom" (the user's own creation). The wording
 * matches how the rest of the app speaks: built-ins save-as-your-copy when
 * edited, customs edit in place.
 */
export function SkillSourceBadge({
    source,
    className,
}: {
    source: "builtin" | "custom" | undefined;
    className?: string;
}) {
    // Theme-aware brand mark — same pair the navbar Logo uses, so the badge
    // carries the current brand glyph instead of the retired logo-mark.
    const logoMark = useColorModeValue(logoLight, logoDark);
    if (source === "custom") {
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
    return (
        <span
            className={
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-console-accent-soft px-2 py-0.5 text-[10px] font-medium text-console-accent-strong " +
                (className || "")
            }
            title="Provided by Relativity — editing it saves your own copy"
        >
            <img src={logoMark} alt="" aria-hidden className="size-3 object-contain" />
            Built-in
        </span>
    );
}

import { Textarea } from "@/components/ui/textarea";

const TARGET_MIN = 120;

interface PhilosophySectionProps {
    philosophy: string;
    onChange: (v: string) => void;
}

export default function PhilosophySection({ philosophy, onChange }: PhilosophySectionProps) {
    const chars = philosophy.length;

    return (
        <div className="flex flex-col gap-3">
            <Textarea
                value={philosophy}
                onChange={(e) => onChange(e.target.value)}
                placeholder="I am a …"
                className="min-h-44 resize-y rounded-none border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 py-2 text-[15px] leading-relaxed shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent"
                aria-label="Agent philosophy"
                data-testid="forge-philosophy"
            />
            <p
                className={
                    chars === 0 || chars >= TARGET_MIN
                        ? "text-[11px] text-console-ink-4"
                        : "text-[11px] text-console-ink-3"
                }
            >
                {chars === 0
                    ? "Blank — the agent falls back to a generic framework."
                    : chars < TARGET_MIN
                        ? `${chars} characters. A philosophy this short leaves the agent guessing.`
                        : `${chars} characters.`}
            </p>
        </div>
    );
}

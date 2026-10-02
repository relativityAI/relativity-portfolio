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
                placeholder="Write the agent's investing beliefs in your own words — what it buys, what it refuses, how it thinks about risk and time. The more detailed, the more it behaves like you."
                className="min-h-44 resize-y bg-transparent px-3 py-3 text-[15px] leading-relaxed focus-visible:bg-console-recessed/40 focus-visible:shadow-none"
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

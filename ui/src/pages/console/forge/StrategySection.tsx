import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";

const HORIZONS = [
    { value: "Intraday", label: "Intraday" },
    { value: "Swing", label: "Swing" },
    { value: "Positional", label: "Positional" },
    { value: "Long-term (years)", label: "Long-term" },
];

function zoneOf(risk: number): string {
    if (risk <= 3) return "Capital preservation";
    if (risk <= 6) return "Measured";
    return "Aggressive";
}

interface StrategySectionProps {
    horizon: string;
    risk: number;
    onChange: (v: { investment_horizon?: string; risk_appetite?: number }) => void;
}

export default function StrategySection({ horizon, risk, onChange }: StrategySectionProps) {
    return (
        <div className="flex flex-col gap-7">
            {/* Horizon — segmented control */}
            <div>
                <p className="mb-2.5 text-xs font-medium text-console-ink-3">
                    Horizon — how long this agent holds
                </p>
                <Tabs
                    value={horizon}
                    onValueChange={(v) => onChange({ investment_horizon: v })}
                >
                    <TabsList aria-label="Investment horizon">
                        {HORIZONS.map((h) => (
                            <TabsTrigger key={h.value} value={h.value}>
                                {h.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {/* Risk — slider */}
            <div>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-console-ink-3">Risk appetite</p>
                    <p className="flex items-baseline gap-1.5">
                        <span className="text-xl font-bold tabular-nums text-console-ink">{risk}</span>
                        <span className="text-[11px] tabular-nums text-console-ink-4">/10</span>
                        <span className="ml-1 text-xs font-medium text-console-accent-strong">
                            {zoneOf(risk)}
                        </span>
                    </p>
                </div>
                <Slider
                    value={[risk]}
                    onValueChange={(v) => onChange({ risk_appetite: v[0] })}
                    min={1}
                    max={10}
                    step={1}
                    aria-label="Risk appetite"
                />
                <div className="mt-2.5 flex justify-between text-[11px] text-console-ink-3">
                    <span>Preserve capital</span>
                    <span>Chase returns</span>
                </div>
            </div>
        </div>
    );
}

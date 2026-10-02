import { SOURCES } from "@/lib/dataSources";
import { SOURCE_DEFS, SourceMark, type SourceKey } from "@/lib/sourceLogos";

const SOURCE_KEYS: SourceKey[] = ["sec", "nse", "voyager", "youtube", "reddit"];

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface-recessed)] px-3 py-1.5 shrink-0">
            {children}
        </div>
    );
}

function Track() {
    return (
        <div className="flex items-center gap-3 px-1.5">
            {SOURCE_KEYS.map((k) => (
                <Chip key={k}>
                    <SourceMark source={k} size={19} />
                    <span className="font-[family-name:var(--font-mono)] text-xs font-medium text-[var(--ink-secondary)] whitespace-nowrap">
                        {SOURCE_DEFS[k].label}
                    </span>
                </Chip>
            ))}
            {SOURCES.map((s) => (
                <Chip key={s.label}>
                    <s.icon size={12} color="var(--ink-tertiary)" />
                    <span className="font-[family-name:var(--font-mono)] text-xs font-medium text-[var(--ink-secondary)] whitespace-nowrap">
                        {s.label}
                    </span>
                </Chip>
            ))}
        </div>
    );
}

export default function DataSourceMarquee() {
    return (
        <div className="overflow-hidden w-full" aria-hidden="true">
            <div className="marquee-track">
                <Track />
                <Track />
            </div>
        </div>
    );
}
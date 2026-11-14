import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Avatar, Style } from "@dicebear/core";
import pixelArtDefinition from "@dicebear/styles/pixel-art.json";

const pixelArt = new Style(pixelArtDefinition);

export interface AgentCellAgent {
    /** Default-agent slug → the card links to /agent/:id; absent → legacy /analysis-list. */
    id?: string;
    name: string;
    seed: string;
    when: string;
    rating: { label: string; color: string };
}

export function AgentAvatar({ seed, size = 64 }: { seed: string; size?: number }) {
    const svg = useMemo(
        () =>
            new Avatar(pixelArt, { seed })
                .toString()
                .replace("<svg ", '<svg width="100%" height="100%" '),
        [seed]
    );
    return (
        <span
            className="inline-block flex-shrink-0"
            style={{ width: size, height: size }}
            role="img"
            aria-label={`${seed} avatar`}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

function LivePulse({ size = 20 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            className="flex-shrink-0"
            aria-hidden="true"
        >
            <circle cx="8" cy="8" r="2.5" fill="none" stroke="var(--signal-live)" strokeWidth="1.25">
                <animate
                    attributeName="r"
                    values="2.5;7;2.5"
                    dur="1.8s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
                    keyTimes="0;0.5;1"
                />
                <animate
                    attributeName="opacity"
                    values="0.7;0;0.7"
                    dur="1.8s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
                    keyTimes="0;0.5;1"
                />
            </circle>
            <circle cx="8" cy="8" r="2.5" fill="var(--signal-live)" />
        </svg>
    );
}

/** Avatar + live pulse + timestamp + name + rating. The whole card is a
 *  link: hover blurs the body and floats "Read full" on top. All of that
 *  lives in named `.agent-cell*` rules in index.css — the global
 *  no-hover-fill rule neutralizes hover:bg utilities app-wide, and
 *  data-solid opts the card out of the a:hover brightness tint. */
export default function AgentCell({ agent }: { agent: AgentCellAgent }) {
    return (
        <Link
            to={agent.id ? `/agent/${agent.id}` : "/analysis-list"}
            data-solid=""
            className="agent-cell flex items-stretch gap-3 p-3 transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
        >
            <div className="agent-cell-body flex min-w-0 flex-1 items-stretch gap-3">
                <AgentAvatar seed={agent.seed} size={64} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap font-[family-name:var(--font-body)] text-[10px] font-normal tracking-wide text-[var(--ink-tertiary)]">
                            {agent.when}
                        </span>
                        <LivePulse size={22} />
                    </div>
                    <h3 className="mt-1.5 font-[family-name:var(--font-display)] font-normal text-[var(--ink-primary)] text-lg leading-snug">{agent.name}</h3>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <p
                            className="text-xs font-[family-name:var(--font-body)] font-medium tracking-wide"
                            style={{ color: agent.rating.color }}
                        >
                            {agent.rating.label}
                        </p>
                    </div>
                </div>
            </div>
            <span className="agent-cell-cue font-[family-name:var(--font-body)] text-xs font-normal text-[#4A6E8E]">
                Read full
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 9L9 3" />
                    <path d="M4.5 3H9v4.5" />
                </svg>
            </span>
        </Link>
    );
}

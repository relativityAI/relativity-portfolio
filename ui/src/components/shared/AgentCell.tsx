import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Avatar, Style } from "@dicebear/core";
import pixelArtDefinition from "@dicebear/styles/pixel-art.json";

const pixelArt = new Style(pixelArtDefinition);

export interface AgentCellAgent {
    name: string;
    seed: string;
    when: string;
    rating: { label: string; color: string };
}

function AgentAvatar({ seed, size = 64 }: { seed: string; size?: number }) {
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

/** Avatar + live pulse + timestamp + name + rating + link. Hover fills a
 *  soft rounded background (`.agent-cell` in index.css — a hover:bg utility
 *  would be neutralized by the global no-hover-fill rule). */
export default function AgentCell({ agent }: { agent: AgentCellAgent }) {
    return (
        <div className="agent-cell flex items-stretch gap-3 p-3 transition-colors">
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
                    <Link
                        to="/analysis-list"
                        className="inline-flex flex-shrink-0 items-center gap-1 font-[family-name:var(--font-body)] text-xs font-normal text-[#4A6E8E] hover:text-[var(--ink-primary)] transition-colors underline-offset-2 hover:underline cursor-pointer"
                    >
                        Read full
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 9L9 3" />
                            <path d="M4.5 3H9v4.5" />
                        </svg>
                    </Link>
                </div>
            </div>
        </div>
    );
}

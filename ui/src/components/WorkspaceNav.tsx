import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * App-level level-3 nav row: Agents / Skills on the left (workspace), plus
 * New Run / Past Runs pushed right. Sits directly under the navbar's level 2
 * and stays visible across the workspace and the whole runs flow. Scrolls
 * horizontally on small screens with the scrollbar hidden.
 */

const NAV_ITEMS = [
    { to: "/my-workspace", label: "Agents", end: true, dot: "#7A8B9E" },
    { to: "/my-workspace/skills", label: "Skills", end: false, dot: "#7A9E7E" },
];

const RUN_ITEMS = [
    { to: "/new-analysis", label: "New Run", end: true, dot: "#7A9E7E" },
    { to: "/analysis-list", label: "Past Runs", end: false, dot: "#C49A6C" },
];

function NavItem({ to, label, end, dot }: { to: string; label: string; end: boolean; dot: string }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                cn(
                    "flex items-center gap-2 text-sm transition-colors cursor-pointer shrink-0",
                    isActive
                        ? "text-[var(--ink-primary)]"
                        : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                )
            }
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
            {label}
        </NavLink>
    );
}

export default function WorkspaceNav() {
    return (
        <nav className="bg-[var(--surface-canvas)] shrink-0">
            <div className="max-w-[1200px] mx-auto">
                <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="px-6 flex h-9 items-center justify-end gap-6 font-[family-name:var(--font-body)] font-light min-w-max">
                        {NAV_ITEMS.map((item) => (
                            <NavItem key={item.to} {...item} />
                        ))}
                        {RUN_ITEMS.map((item) => (
                            <NavItem key={item.to} {...item} />
                        ))}
                    </div>
                </div>
                <div className="px-6"><div className="h-px bg-[var(--hairline)]" /></div>
            </div>
        </nav>
    );
}

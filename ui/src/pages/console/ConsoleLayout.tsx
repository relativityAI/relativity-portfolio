import { Outlet, useLocation, NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The console shell. The old left sidebar is gone — its items now live as a
 * horizontal nav row directly under the app's navbar level 2, styled to match
 * it (same dot + 13px link, 36px row, hairline underneath). The content area
 * below is full width.
 */

const NAV_ITEMS = [
    { to: "/console", label: "Agents", end: true, dot: "#7A8B9E" },
    { to: "/console/skills", label: "Skills", end: false, dot: "#7A9E7E" },
];

export default function ConsoleLayout() {
    const location = useLocation();

    return (
        <div className="flex h-full min-h-0 flex-col bg-console-canvas">
            {/* Console nav — mirrors the navbar's level 2 */}
            <nav className="shrink-0 bg-console-canvas">
                <div className="flex h-9 items-center gap-6 font-[family-name:var(--font-body)] font-light">
                    {NAV_ITEMS.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) =>
                                cn(
                                    "flex items-center gap-2 text-sm transition-colors cursor-pointer",
                                    isActive
                                        ? "text-[var(--ink-primary)]"
                                        : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                                )
                            }
                        >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                            {item.label}
                        </NavLink>
                    ))}
                </div>
                <div className="h-px bg-[var(--hairline)]" />
            </nav>

            <main className="min-h-0 flex-1 overflow-y-auto" id="console-content">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="flex min-h-full flex-col [&>*]:min-h-0"
                    >
                        <Outlet />
                    </motion.div>
                </AnimatePresence>
            </main>
        </div>
    );
}

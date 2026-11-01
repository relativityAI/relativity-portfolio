import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

/**
 * The My Workspace shell — the animated content area only. The level-3 nav
 * row (Agents / Skills / New Run / Past Runs) is app-level chrome now; it
 * lives in WorkspaceNav and stays visible across the workspace and runs flow.
 */

export default function ConsoleLayout() {
    const location = useLocation();

    return (
        <div className="flex h-full min-h-0 flex-col bg-console-canvas">
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

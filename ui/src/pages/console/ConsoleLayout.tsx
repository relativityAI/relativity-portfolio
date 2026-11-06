import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

/**
 * The My Workspace shell — the animated content area only. Scrolling belongs
 * to the page itself (App's route container), so this renders plain flow:
 * content grows the page and the window scrollbar does the rest.
 */

export default function ConsoleLayout() {
    const location = useLocation();

    return (
        <div className="flex min-h-full flex-col bg-console-canvas">
            <main className="flex-1" id="console-content">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="flex min-h-full flex-col"
                    >
                        <Outlet />
                    </motion.div>
                </AnimatePresence>
            </main>
        </div>
    );
}

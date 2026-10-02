import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import ConsoleSidebar from "./ConsoleSidebar";
import { AgentService } from "@/db";

/**
 * The console shell: a persistent, collapsible left sidebar (official shadcn
 * Sidebar) and one content area where every console view — library, skills,
 * builder chat, agent settings — opens. Crossing in should feel like one
 * continuous app surface: no grain, no nested boxes, no double margins.
 */

export default function ConsoleLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);

    // When a settings route is open, surface that agent's identity in the
    // sidebar. A failed lookup never blocks the page.
    const agentMatch = location.pathname.match(/^\/console\/agent\/([^/]+)$/);
    // "new" is a creation route, not an agent — don't look it up.
    const agentId = agentMatch?.[1] && agentMatch[1] !== "new" ? agentMatch[1] : null;

    useEffect(() => {
        if (!agentId) { setAgent(null); return; }
        let cancelled = false;
        setAgent((prev) => (prev?.id === agentId ? prev : { id: agentId, name: "" }));
        AgentService.readAgent(agentId)
            .then((data) => {
                if (!cancelled && data?.name) setAgent({ id: agentId, name: data.name });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [agentId]);

    // The settings route lives at /console/agent/:id — deep links to the old
    // /agent/:id are redirected at the router level, but keep a guard here so
    // a stray /agent/new still lands in the console.
    useEffect(() => {
        if (location.pathname === "/agent/new") navigate("/console/agent/new", { replace: true });
    }, [location.pathname, navigate]);

    return (
        <SidebarProvider className="console-shell">
            <ConsoleSidebar agent={agent} />
            <SidebarInset className="min-w-0 bg-console-canvas">
                {/* Header bar: collapse trigger lives here, per the docs */}
                <header className="flex h-10 shrink-0 items-center gap-2 px-4">
                    <SidebarTrigger aria-label="Toggle sidebar" />
                </header>
                {/* Height-bounded scroll container: views that manage their own
                    internal scrolling (skills, builder) fill it exactly; views
                    that are ordinary pages just overflow it. */}
                <main className="min-h-0 flex-1 overflow-y-auto" id="console-content">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={location.pathname}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                            className="min-h-full h-full flex flex-col [&>*]:min-h-0"
                        >
                            <Outlet />
                        </motion.div>
                    </AnimatePresence>
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
}

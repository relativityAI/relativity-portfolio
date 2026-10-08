import { NavLink, useNavigate } from "react-router-dom";
import { Bot, Blocks, ArrowLeft } from "lucide-react";
import {
    Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
    SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
    SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { cn } from "@/lib/utils";

/**
 * The console sidebar — the official shadcn/ui Sidebar, so it collapses to
 * icons (via SidebarTrigger / keyboard shortcut) exactly as documented.
 * Everything else (library, skills, builder chat, agent settings) opens in
 * the space to its right; the sidebar itself never unmounts.
 */

const NAV_ITEMS = [
    { to: "/console", label: "Agents", icon: Bot, end: true },
    { to: "/console/skills", label: "Agent Skills", icon: Blocks, end: false },
];

export interface ConsoleSidebarAgent {
    id: string;
    name: string;
}

interface ConsoleSidebarProps {
    /** When an agent's settings are open, its identity shows at the top. */
    agent?: ConsoleSidebarAgent | null;
}

export default function ConsoleSidebar({ agent }: ConsoleSidebarProps) {
    const navigate = useNavigate();

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                {/* Open-agent identity card — replaces the title while editing */}
                {agent ? (
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                onClick={() => navigate("/console")}
                                tooltip={`Back to agents (editing ${agent.name || "agent"})`}
                                aria-label={`Back to agents (editing ${agent.name || "agent"})`}
                            >
                                {/* Pass the id through: the seed is id-first, so the
                                    portrait matches the settings page exactly. */}
                                <AgentAvatar
                                    agent={{ id: agent.id, name: agent.name }}
                                    size={24}
                                    label={agent.name || "Agent"}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-semibold">
                                        {agent.name || "Untitled agent"}
                                    </span>
                                    <span className="block text-[11px] opacity-70">
                                        Agent settings
                                    </span>
                                </span>
                                <ArrowLeft className="size-4 opacity-60" />
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                ) : (
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild tooltip="Agent Console">
                                <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                                    Agent Console
                                </span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                )}
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Console</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {NAV_ITEMS.map((item) => (
                                <SidebarMenuItem key={item.to}>
                                    <NavLink to={item.to} end={item.end}>
                                        {({ isActive }) => (
                                            <SidebarMenuButton
                                                isActive={isActive}
                                                tooltip={item.label}
                                                className={cn(
                                                    "w-full !bg-transparent",
                                                    isActive && "font-bold text-white hover:!bg-transparent",
                                                )}
                                            >
                                                <item.icon />
                                                <span>{item.label}</span>
                                            </SidebarMenuButton>
                                        )}
                                    </NavLink>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                </SidebarContent>

            <SidebarFooter>
                <p className="px-2 pb-2 text-[11px] leading-relaxed text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                    Build analysts, give them skills, and put them to work.
                </p>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}

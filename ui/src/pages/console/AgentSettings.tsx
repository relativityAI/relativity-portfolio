import {
    useParams, useNavigate, useBlocker,
} from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
    Download, Trash2, MoreHorizontal, Copy, Save,
} from "lucide-react";

import { AgentService, SkillService } from "@/db";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toaster } from "@/compat/ui";
import {
    agentToMarkdown, sectionToMarkdown, skillsMarkdown,
} from "@/lib/sectionMarkdown";
import { draftKey, clearLocalDraft } from "@/lib/autosave";
import { zipFiles, downloadBlob } from "@/lib/zip";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import PhilosophySection from "./forge/PhilosophySection";
import SkillsSection from "./forge/SkillsSection";

/**
 * Agent settings — inside the console. One straight, centered form:
 * name → philosophy → skills. Autosave blocker / export / delete as before.
 */

const DEFAULT_AGENT = {
    name: "",
    id: "",
    _id: "",
    created_at: "",
    persona: { philosophy: "" },
    skills: [] as { skill_id: string; weight: number }[],
}

export default function AgentSettings() {
    const urlParams = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [nameError, setNameError] = useState(false)
    const [agent, setAgent] = useState<any>({ ...DEFAULT_AGENT })
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [navOpen, setNavOpen] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)

    // "new" is a static route with no :id param, so urlParams.id is undefined
// there — treat both shapes as a new agent.
const isNew = !urlParams.id || urlParams.id === "new"
    const agentId = agent.id || agent._id || null
    const storageKey = draftKey(agentId || "new")

    // Skill id -> display name.
    const [skillNames, setSkillNames] = useState<Record<string, string>>({})
    useEffect(() => {
        const ids = (agent.skills || []).map((s: { skill_id: string }) => s.skill_id)
        if (!ids.length) { setSkillNames({}); return }
        let cancelled = false
        Promise.all(
            ids.map(async (id) => {
                try {
                    const full = await SkillService.readSkill(id)
                    return [id, full?.name || id] as const
                } catch { return [id, id] as const }
            }),
        ).then((pairs) => { if (!cancelled) setSkillNames(Object.fromEntries(pairs)) })
        return () => { cancelled = true }
    }, [agent.skills])

    const fetchAgent = async () => {
        try {
            if (urlParams.id && !isNew) {
                const data = await AgentService.readAgent(urlParams.id)
                if (!data) throw new Error("This agent no longer exists.")
                setAgent({
                    name: data.name || "",
                    id: data.id || data._id || "",
                    _id: data._id || data.id || "",
                    created_at: data.created_at || "",
                    md: data.md || "",
                    persona: { philosophy: data.persona?.philosophy ?? data.persona?.philosophy_and_mindset ?? "" },
                    skills: Array.isArray(data.skills)
                        ? data.skills.map((s: any) =>
                            typeof s === "string" ? { skill_id: s, weight: 5 } : { skill_id: s.skill_id, weight: s.weight ?? 5 },
                        )
                        : [],
                })
                setIsDirty(false)
                setLoadError(null)
            } else {
                setAgent({ ...DEFAULT_AGENT })
                // A fresh agent has nothing to lose — don't arm the blocker
                // until the user actually edits something.
                setIsDirty(false)
                setLoadError(null)
            }
        } catch (error: any) {
            console.error("API Error:", error)
            const status = error?.response?.status
            setLoadError(
                status === 404
                    ? "This agent doesn't exist, or you don't have access to it."
                    : "Couldn't load this agent. Check your connection and try again.",
            )
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchAgent()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlParams.id])

// A ref, not state: after a successful save we must skip the blocker for the
// redirect that immediately follows, and a setState flush is too late for that.
const savedRef = useRef(false)

const blocker = useBlocker(() => isDirty && !savedRef.current)
useEffect(() => {
    if (blocker.state === "blocked") setNavOpen(true)
}, [blocker.state])

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) { e.preventDefault(); e.returnValue = "" }
        }
        window.addEventListener("beforeunload", handler)
        return () => window.removeEventListener("beforeunload", handler)
    }, [isDirty])

    /* ── Save ─────────────────────────────────────────────────────────── */

    const handleSave = async () => {
        if (!agent.name?.trim()) {
            setNameError(true)
            toaster.create({ title: "Name required", description: "Give this agent a name before saving.", type: "error" })
            return
        }
        setNameError(false)
        if (!agent.skills || agent.skills.length === 0) {
            toaster.create({
                title: "Attach at least one skill",
                description: "An agent needs at least one skill to run an analysis. Add one below.",
                type: "error",
            })
            return
        }
        try {
            setSaving(true)
            const currentId = agent.id || agent._id || null
            const dataToSave = {
                name: agent.name,
                persona: agent.persona,
                skills: (agent.skills || []).map((s: any) => ({ skill_id: s.skill_id, weight: s.weight ?? 5 })),
            }

            if (currentId) {
                await AgentService.updateAgent({ ...dataToSave, id: currentId, _id: currentId })
                setAgent((prev: any) => ({ ...prev, id: currentId, _id: currentId }))
            } else {
                const created = await AgentService.createAgent(dataToSave)
                const newId = created.id || created._id
                if (newId) {
                    setAgent((prev: any) => ({ ...prev, id: newId, _id: newId }))
                    // Tell the blocker we're intentionally leaving a clean
                    // agent, then go — otherwise it prompts to discard work
                    // that was just persisted.
                    savedRef.current = true
                    clearLocalDraft(storageKey)
                    navigate("/console/agent/" + newId, { replace: true })
                }
            }

            setIsDirty(false)
            clearLocalDraft(storageKey)
            toaster.create({ title: "Changes saved", type: "success" })
        } catch (error: any) {
            console.error("Save Error:", error)
            const apiMsg = error?.response?.data?.issues?.[0]?.message
                || error?.response?.data?.error
                || error?.message
                || "Please try again."
            toaster.create({ title: "Couldn't save", description: apiMsg, type: "error" })
        } finally {
            setSaving(false)
        }
    }

    /* ── Delete / export ──────────────────────────────────────────────── */

    const confirmDelete = async () => {
        setDeleteOpen(false)
        try {
            await AgentService.deleteAgent(agentId)
            clearLocalDraft(storageKey)
            toaster.create({ title: "Agent deleted", type: "success" })
            navigate("/console")
        } catch (error) {
            console.error("Delete Error:", error)
            toaster.create({ title: "Couldn't delete", type: "error" })
        }
    }

    const [exporting, setExporting] = useState(false)
    const handleExport = async () => {
        setExporting(true)
        try {
            const attached = agent.skills || []
            const safeSegment = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_") || "skill"
            const skills = await Promise.all(
                attached.map(async (s: any) => {
                    const path = `skills/${safeSegment(s.skill_id)}.md`
                    try {
                        const full = await SkillService.readSkill(s.skill_id)
                        return { path, text: full?.markdown || `# ${s.skill_id}\n\n(empty skill document)` }
                    } catch {
                        return { path, text: `# ${s.skill_id}\n\nSkill document unavailable offline (custom skill not reachable).` }
                    }
                }),
            )
            const record = {
                name: agent.name, id: agentId, persona: agent.persona, skills: attached,
            }
            const readable = { ...agent, skills: attached.map((s: any) => ({ ...s, skill_id: skillNames[s.skill_id] || s.skill_id })) }
            const bundle = zipFiles([
                { path: "agent.md", text: agentToMarkdown(readable) },
                { path: "agent.json", text: JSON.stringify(record, null, 2) },
                { path: "persona.md", text: sectionToMarkdown("persona", readable) },
                { path: "skills.md", text: skillsMarkdown(readable) },
                ...skills,
            ])
            const slug = (agent.name || "agent").replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "agent"
            downloadBlob(bundle, `${slug}.zip`)
            toaster.create({
                title: "Agent exported",
                description: `${skills.length} capability document${skills.length === 1 ? "" : "s"} included.`,
                type: "success",
            })
        } catch (error: any) {
            toaster.create({ title: "Couldn't export agent", description: error?.message, type: "error" })
        } finally {
            setExporting(false)
        }
    }

    const copyAgentId = async () => {
        if (!agentId) return
        try {
            await navigator.clipboard.writeText(agentId)
            toaster.create({ title: "Copied agent ID", type: "success" })
        } catch {
            toaster.create({ title: "Couldn't copy agent ID", type: "error" })
        }
    }

    const updateAgent = (updates: any) => {
        setAgent((prev: any) => ({ ...prev, ...updates }))
        if (!loading) setIsDirty(true)
    }

    /* ── Ambient save state ───────────────────────────────────────────── */

    const saveState = saving
        ? { label: "Saving…", tone: "accent" as const }
        : isDirty
            ? { label: "Unsaved changes", tone: "caution" as const }
            : isNew
                ? { label: "Draft", tone: "muted" as const }
                : { label: "Saved", tone: "positive" as const }

    const metaLine = !isNew ? [
        agentId ? `ID ${String(agentId).slice(0, 10)}` : null,
        agent.created_at ? new Date(agent.created_at).toLocaleDateString() : null,
    ].filter(Boolean).join("  ·  ") : null

    if (loading) return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-2 border-console-accent border-t-transparent" aria-label="Loading" />
        </div>
    )

    // A failed load must never render an editable blank form — it would look
    // like a saved agent and the next save would create a duplicate.
    if (loadError) return (
        <div className="mx-auto w-full max-w-md px-5 py-20 text-center sm:px-8">
            <p className="text-base font-semibold text-console-ink">Agent unavailable</p>
            <p className="mt-1.5 text-[13px] text-console-ink-3">{loadError}</p>
            <div className="mt-5 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate("/console")}>
                    Back to agents
                </Button>
                <Button size="sm" onClick={() => { setLoading(true); fetchAgent() }}>
                    Try again
                </Button>
            </div>
        </div>
    )

    return (
        <div className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
            {/* Sticky header — title, save state, actions */}
            <div className="sticky top-0 z-10 -mx-5 bg-console-canvas/90 px-5 py-3 backdrop-blur-md sm:-mx-8 sm:px-8">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <AgentAvatar agent={agent} size={40} label={agent.name || "Agent"} />
                        <div className="min-w-0 max-w-72 flex-1">
                            <p className="truncate px-2 text-lg font-bold tracking-tight text-console-ink">
                                {agent.name?.trim() || "New agent"}
                            </p>
                            {metaLine && (
                                <p className="truncate font-mono text-[11px] text-console-ink-4">{metaLine}</p>
                            )}
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="More actions">
                                    <MoreHorizontal />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleExport} disabled={exporting}>
                                    <Download /> Export agent
                                </DropdownMenuItem>
                                {agentId && (
                                    <>
                                        <DropdownMenuItem onClick={copyAgentId}>
                                            <Copy /> Copy agent ID
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                                            <Trash2 /> Delete agent
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Ambient save state */}
                        <span className="mr-1 inline-flex items-center gap-1.5" data-testid="agent-status">
                            <span className={cn(
                                "size-1.5 rounded-full",
                                saveState.tone === "accent" && "bg-console-accent animate-pulse",
                                saveState.tone === "caution" && "bg-console-negative",
                                saveState.tone === "positive" && "bg-console-positive",
                                saveState.tone === "muted" && "bg-console-ink-4",
                            )} />
                            <span className={cn(
                                "text-xs font-medium",
                                saveState.tone === "caution" ? "text-console-negative" : "text-console-ink-3",
                            )}>
                                {saveState.label}
                            </span>
                        </span>

                        <Button size="sm" onClick={handleSave} disabled={saving} data-testid="agent-save">
                            <Save /> {isNew ? "Create agent" : "Save"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Body: one straight form, centered */}
            <div className="mx-auto mt-10 max-w-2xl">
                <section className="pb-12">
                    <header className="mb-4">
                        <h2 className="text-xl font-bold tracking-tight text-console-ink">Name</h2>
                        <p className="mt-1 text-[13px] text-console-ink-3">What this agent is called.</p>
                    </header>
                    <Input
                        value={agent.name}
                        onChange={(e) => { updateAgent({ name: e.target.value }); setNameError(false) }}
                        placeholder="Untitled agent"
                        aria-label="Agent name"
                        className={cn(
                            "h-auto bg-transparent px-3 py-2.5 text-base shadow-none focus-visible:bg-console-recessed/50 focus-visible:shadow-none",
                            nameError && "text-console-negative",
                        )}
                        data-testid="agent-name-input"
                    />
                </section>

                <section className="pb-12">
                    <header className="mb-4">
                        <h2 className="text-xl font-bold tracking-tight text-console-ink">Philosophy</h2>
                        <p className="mt-1 text-[13px] text-console-ink-3">Written in the agent's own words.</p>
                    </header>
                    <PhilosophySection
                        philosophy={agent.persona?.philosophy || agent.persona?.philosophy_and_mindset || ""}
                        onChange={(v) => updateAgent({ persona: { philosophy: v } })}
                    />
                </section>

                <section className="pb-6">
                    <header className="mb-4 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-console-ink">Skills</h2>
                            <p className="mt-1 text-[13px] text-console-ink-3">What the agent measures.</p>
                        </div>
                        {(agent.skills?.length ?? 0) > 0 && (
                            <Badge variant="secondary">{agent.skills.length} attached</Badge>
                        )}
                    </header>
                    <SkillsSection
                        skills={agent.skills || []}
                        skillNames={skillNames}
                        onChange={(v) => updateAgent({ skills: v })}
                        onOpenLibrary={() => navigate("/console/skills")}
                        onInspect={(skillId) => navigate(`/console/skills?skill=${encodeURIComponent(skillId)}`)}
                    />
                </section>

                <div className="flex justify-end pb-8">
                    <Button onClick={handleSave} disabled={saving}>
                        <Save /> {isNew ? "Create agent" : "Save"}
                    </Button>
                </div>
            </div>

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{agent.name || "Untitled agent"}" will be permanently removed and cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-console-negative hover:bg-console-negative/85"
                            onClick={(e) => { e.preventDefault(); confirmDelete() }}
                        >
                            <Trash2 /> Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <ConfirmDialog
                open={navOpen}
                title="Leave with unsaved changes?"
                message={`Your changes to "${agent.name || "this agent"}" may be lost if you leave now.`}
                confirmLabel="Leave"
                onCancel={() => { blocker.reset?.(); setNavOpen(false) }}
                onConfirm={() => { blocker.proceed?.(); setNavOpen(false) }}
            />
        </div>
    )
}

import {
    Text, Flex, Button, Spinner, Input, Box, Menu,
} from "@chakra-ui/react"
import { MdOutlineFileDownload, MdOutlineFileUpload, MdSave, MdDeleteForever, MdMoreHoriz, MdOutlineAutoAwesome, MdOutlineFormatAlignLeft, MdContentCopy } from "react-icons/md"

import { useParams, useNavigate, useBlocker } from "react-router-dom"
import { useState, useEffect, useMemo, useRef } from "react"
import { AgentService, VoyagerService } from "@/db"

import { StepRail, MobilePills, type StepDef } from "./AgentSidebarNav"
import AgentOverview from "./AgentOverview"
import ConfigurationSection from "./sections/ConfigurationSection"
import PersonaSection from "./sections/PersonaSection"
import AssetEvalSection from "./sections/AssetEvalSection"
import MacroEvalSection from "./sections/MacroEvalSection"
import { motion, AnimatePresence } from "motion/react"
import { dur, ease } from "@/lib/motion"
import ConfirmDialog from "@/components/ConfirmDialog"
import MarkdownEditorTab, { type MdIssue } from "./MarkdownEditorTab"
import DraftWithAiPanel from "@/components/builder/DraftWithAiPanel"
import { toaster } from "@/components/ui/toaster"
import { sectionToMarkdown, validateSection, parseSection, MD_SECTIONS, type AgentShape } from "@/lib/sectionMarkdown"
import { draftKey, loadLocalDraft, clearLocalDraft, useLocalAutosave } from "@/lib/autosave"
import AgentAvatar from "@/components/shared/AgentAvatar"


const DEFAULT_AGENT = {
    name: "",
    id: "",
    _id: "",
    created_at: "",
    persona: {
        philosophy_and_mindset: "",
    },
    configuration: {
        investment_horizon: "",
        risk_appetite: 5,
    },
    asset_evaluation: {
        qualitative: [],
        quantitative: [],
    },
    macro_evaluation: {
        qualitative: [],
        quantitative: [],
    },
}

const STEPS: StepDef[] = [
    { id: "overview", label: "Overview" },
    { id: "configuration", label: "Configuration" },
    { id: "persona", label: "Agent Persona" },
    { id: "asset_evaluation", label: "Asset Evaluation" },
    { id: "macro_evaluation", label: "Macro Evaluation" },
]

const panelVariants = {
    enter: (dir: number) => ({ opacity: 0, x: 28 * dir }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: -28 * dir }),
}

function computeSectionCompletion(agent: any): Record<string, boolean> {
    return {
        overview: true,
        configuration: !!(agent.configuration?.investment_horizon || agent.configuration?.risk_appetite),
        persona: !!(agent.persona?.philosophy_and_mindset),
        asset_evaluation: !!((agent.asset_evaluation?.qualitative?.length > 0) || (agent.asset_evaluation?.quantitative?.length > 0)),
        macro_evaluation: !!((agent.macro_evaluation?.qualitative?.length > 0) || (agent.macro_evaluation?.quantitative?.length > 0)),
    }
}

function computeOverviewSections(agent: any): { id: string; label: string; summary: string; hasContent: boolean }[] {
    const c = agent.configuration || {}
    const ae = agent.asset_evaluation || {}
    const me = agent.macro_evaluation || {}

    return [
        {
            id: "configuration",
            label: "Configuration",
            summary: [
                c.investment_horizon ? `${c.investment_horizon} horizon` : "",
                c.risk_appetite ? `Risk ${c.risk_appetite}/10` : "",
            ].filter(Boolean).join(" · ") || "Not configured",
            hasContent: !!(c.investment_horizon || c.risk_appetite),
        },
        {
            id: "persona",
            label: "Agent Persona",
            summary: agent.persona?.philosophy_and_mindset ? "Philosophy & mindset written" : "No content yet",
            hasContent: !!agent.persona?.philosophy_and_mindset,
        },
        {
            id: "asset_evaluation",
            label: "Asset Evaluation",
            summary: [
                ae.qualitative?.length ? `${ae.qualitative.length} qualitative parameters` : "",
                ae.quantitative?.length ? `${ae.quantitative.length} quantitative criteria` : "",
            ].filter(Boolean).join(" · ") || "Not configured",
            hasContent: !!(ae.qualitative?.length || ae.quantitative?.length),
        },
        {
            id: "macro_evaluation",
            label: "Macro Evaluation",
            summary: [
                me.qualitative?.length ? `${me.qualitative.length} qualitative factors` : "",
                me.quantitative?.length ? `${me.quantitative.length} quantitative criteria` : "",
            ].filter(Boolean).join(" · ") || "Not configured",
            hasContent: !!(me.qualitative?.length || me.quantitative?.length),
        },
    ]
}

export default function Agent() {
    const urlParams = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [nameError, setNameError] = useState(false)
    const [availableMetrics, setAvailableMetrics] = useState<any>(null)
    const [agent, setAgent] = useState<any>({ ...DEFAULT_AGENT })
    const [step, setStep] = useState<string>("overview")
    const [dir, setDir] = useState<number>(1)
    const [isMobile, setIsMobile] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [navOpen, setNavOpen] = useState(false)
    const [restoreOpen, setRestoreOpen] = useState(false)
    const [hasLocalDraft, setHasLocalDraft] = useState(false)
    const [aiOpen, setAiOpen] = useState(false)
    const [rubric, setRubric] = useState<any>(null)
    const [rubricLoading, setRubricLoading] = useState(false)

    // Per-section markdown (form and md are two views of the same agent object).
    const [mdStep, setMdStep] = useState<string | null>(null)
    const [mdText, setMdText] = useState("")
    const [mdIssues, setMdIssues] = useState<MdIssue[]>([])
    const [mdValidating, setMdValidating] = useState(false)
    const [mdApplying, setMdApplying] = useState(false)

    const isNew = urlParams.id === "new"
    const agentId = agent.id || agent._id || null
    const storageKey = draftKey(agentId || "new")
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const restoreChecked = useRef(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768)
        check()
        window.addEventListener("resize", check)
        return () => window.removeEventListener("resize", check)
    }, [])

    const sectionCompletion = useMemo(() => computeSectionCompletion(agent), [agent])
    const overviewSections = useMemo(() => computeOverviewSections(agent), [agent])

    const goTo = (next: string) => {
        if (next === step) return
        setDir(STEPS.findIndex((s) => s.id === next) > STEPS.findIndex((s) => s.id === step) ? 1 : -1)
        if (mdStep) { setMdStep(null); setMdIssues([]) }
        setStep(next)
    }

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "smooth" })
    }, [step])

    const fetchAgent = async () => {
        try {
            if (urlParams.id && !isNew) {
                const data = await AgentService.readAgent(urlParams.id)
                if (data) {
                    setAgent({
                        name: data.name || "",
                        id: data.id || data._id || "",
                        _id: data._id || data.id || "",
                        created_at: data.created_at || "",
                        md: data.md || "",
                        persona: data.persona ?? DEFAULT_AGENT.persona,
                        configuration: { ...DEFAULT_AGENT.configuration, ...(data.configuration || {}) },
                        asset_evaluation: {
                            qualitative: data.asset_evaluation?.qualitative ?? data.qualitative ?? [],
                            quantitative: data.asset_evaluation?.quantitative ?? [],
                        },
                        macro_evaluation: {
                            qualitative: data.macro_evaluation?.qualitative ?? [],
                            quantitative: data.macro_evaluation?.quantitative ?? [],
                        },
                    })
                    setIsDirty(false)
                }
            } else {
                setAgent({ ...DEFAULT_AGENT })
                setIsDirty(true)
                setStep("configuration")
            }
        } catch (error) {
            console.error("API Error:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        restoreChecked.current = false
        fetchAgent()
    }, [urlParams.id])

    useEffect(() => {
        VoyagerService.getAvailableMetrics("NSE")
            .then((data) => { if (data?.fields) setAvailableMetrics(data) })
            .catch(() => {})
    }, [])

    // v2 rubric: show status + allow approving a draft against the current md.
    useEffect(() => {
        if (isNew || !agentId) return
        setRubricLoading(true)
        AgentService.getRubric(agentId)
            .then((d) => setRubric(d?.rubric ?? null))
            .catch(() => {})
            .finally(() => setRubricLoading(false))
    }, [isNew, agentId, saved])

    const handleCompileRubric = async () => {
        setRubricLoading(true)
        try {
            const d = await AgentService.compileRubric(agentId)
            if (d?.rubric) {
                setRubric(d.rubric)
                toaster.create({ title: "Rubric compiled", description: d.error || "", type: d.error ? "error" : "success" })
            } else if (d?.error) {
                toaster.create({ title: "Couldn't compile rubric", description: d.error, type: "error" })
            }
        } catch (error: any) {
            toaster.create({ title: "Couldn't compile rubric", description: error?.response?.data?.error || error?.message, type: "error" })
        } finally {
            setRubricLoading(false)
        }
    }

    const handleApproveRubric = async () => {
        if (!rubric?.id) return
        setRubricLoading(true)
        try {
            const d = await AgentService.approveRubric(agentId, rubric.id)
            setRubric(d?.rubric ?? rubric)
            toaster.create({ title: "Rubric approved", type: "success" })
        } catch (error: any) {
            toaster.create({ title: "Couldn't approve rubric", description: error?.response?.data?.error || error?.message, type: "error" })
        } finally {
            setRubricLoading(false)
        }
    }

    // Autosave — a recovery net on this device only. "Saved" still means the server.
    useLocalAutosave(storageKey, { ...agent }, !loading)

    // Offer to restore the last local draft once the agent has loaded.
    useEffect(() => {
        if (loading || restoreChecked.current) return
        restoreChecked.current = true
        const saved = loadLocalDraft<AgentShape>(storageKey)
        if (!saved) return
        setHasLocalDraft(true)
        if (isNew || JSON.stringify(saved.data) !== JSON.stringify(agent)) {
            setRestoreOpen(true)
        }
    }, [loading, storageKey, agent, isNew])

    const restoreDraft = () => {
        const saved = loadLocalDraft<AgentShape>(storageKey)
        if (saved) {
            setAgent(saved.data)
            setHasLocalDraft(true)
            setIsDirty(true)
            toaster.create({ title: "Draft restored from this device", type: "success" })
        }
        setRestoreOpen(false)
    }

    const discardDraft = () => {
        clearLocalDraft(storageKey)
        setHasLocalDraft(false)
        setRestoreOpen(false)
    }

    // Block leaving while there's unsaved work (or an open AI session).
    const blocker = useBlocker(isDirty || aiOpen)
    useEffect(() => {
        if (blocker.state === "blocked") setNavOpen(true)
    }, [blocker.state])

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault()
                e.returnValue = ""
            }
        }
        window.addEventListener("beforeunload", handler)
        return () => window.removeEventListener("beforeunload", handler)
    }, [isDirty])

    const VALID_METRIC_TYPES = new Set(["number", "currency", "percentage", "date", "text"])

    const normalizeMetrics = (arr: any[]) =>
        arr?.map((item: any) => ({
            ...item,
            metric_type: VALID_METRIC_TYPES.has(item.metric_type) ? item.metric_type : "number",
        })) ?? []

    /* ── Per-section markdown ─────────────────────────────────────────── */

    const toggleMarkdownView = () => {
        if (mdStep === step) {
            setMdStep(null)
            setMdIssues([])
            return
        }
        const current = sectionToMarkdown(step, agent)
        setMdStep(step)
        setMdText(current)
        setMdIssues([])
        validateSection(step, current, agent).then(setMdIssues)
    }

    const onMdChange = (v: string) => {
        setMdText(v)
        setMdIssues([])
        setIsDirty(true)
    }

    const runMdValidate = async () => {
        setMdValidating(true)
        try {
            setMdIssues(await validateSection(step, mdText, agent))
        } finally {
            setMdValidating(false)
        }
    }

    const applySectionMarkdown = () => {
        if (mdIssues.some((i) => i.severity === "error")) {
            toaster.create({ title: "Fix the markdown errors first", type: "error" })
            return
        }
        setMdApplying(true)
        const res = parseSection(step, mdText)
        setMdApplying(false)
        if (!res.ok) {
            setMdIssues(res.issues.map((m) => ({ line: 0, message: m, severity: "error" as const })))
            toaster.create({ title: "Couldn't apply markdown", description: res.issues[0], type: "error" })
            return
        }
        setAgent((prev: any) => ({ ...prev, ...res.merged }))
        setMdStep(null)
        setMdIssues([])
        setIsDirty(true)
        toaster.create({ title: "Applied to this section", type: "success" })
    }

    /* ── Save ─────────────────────────────────────────────────────────── */

    const handleSave = async () => {
        if (!agent.name?.trim()) {
            setNameError(true)
            toaster.create({ title: "Name required", description: "Give this agent a name before saving.", type: "error" })
            return
        }
        setNameError(false)
        try {
            setSaving(true)
            let newId = agentId
            const stripIds = (items: any[]) => items?.map(({ id, ...rest }: any) => { void id; return rest }) ?? []
            const dataToSave = {
                name: agent.name,
                persona: agent.persona,
                configuration: agent.configuration,
                asset_evaluation: {
                    qualitative: stripIds(agent.asset_evaluation?.qualitative),
                    quantitative: normalizeMetrics(agent.asset_evaluation?.quantitative),
                },
                macro_evaluation: {
                    qualitative: stripIds(agent.macro_evaluation?.qualitative),
                    quantitative: normalizeMetrics(agent.macro_evaluation?.quantitative),
                },
            }

            if (newId) {
                await AgentService.updateAgent({ ...dataToSave, id: newId, _id: newId })
            } else {
                const created = await AgentService.createAgent(dataToSave)
                newId = created.id || created._id
            }

            if (newId) {
                setAgent((prev: any) => ({ ...prev, id: newId, _id: newId }))
                setIsDirty(false)
                setHasLocalDraft(false)
                clearLocalDraft(storageKey)
                if (isNew) navigate("/agent/" + newId, { replace: true })
                toaster.create({ title: "Changes saved", type: "success" })
                setSaved(true)
                if (saveTimer.current) clearTimeout(saveTimer.current)
                saveTimer.current = setTimeout(() => setSaved(false), 3000)
            }
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

    /* ── Delete ───────────────────────────────────────────────────────── */

    const confirmDelete = async () => {
        setDeleteOpen(false)
        try {
            await AgentService.deleteAgent(agentId)
            clearLocalDraft(storageKey)
            toaster.create({ title: "Agent deleted", type: "success" })
            navigate("/agents")
        } catch (error) {
            console.error("Delete Error:", error)
            toaster.create({ title: "Couldn't delete", type: "error" })
        }
    }

    /* ── Import / Export / Copy ID ────────────────────────────────────── */

    const applyMarkdownImport = (raw: string) => {
        const dev: AgentShape = { ...DEFAULT_AGENT, ...agent }
        const failed: string[] = []
        for (const s of MD_SECTIONS) {
            const r = parseSection(s, raw)
            if (r.ok) Object.assign(dev, r.merged)
            else failed.push(...r.issues)
        }
        setAgent(dev)
        setIsDirty(true)
        if (failed.length) {
            toaster.create({ title: "Imported with issues", description: failed[0], type: "warning" })
        } else {
            toaster.create({ title: "Imported agent", type: "success" })
        }
    }

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            const raw = ev.target?.result as string
            try {
                if (raw.trimStart().startsWith("---")) {
                    applyMarkdownImport(raw)
                    return
                }
                const data = JSON.parse(raw)
                if (data.asset_evaluation?.quantitative) {
                    data.asset_evaluation.quantitative = normalizeMetrics(data.asset_evaluation.quantitative)
                }
                if (data.macro_evaluation?.quantitative) {
                    data.macro_evaluation.quantitative = normalizeMetrics(data.macro_evaluation.quantitative)
                }
                if (data.asset_evaluation || data.macro_evaluation) {
                    setAgent((prev: any) => ({
                        ...prev,
                        ...data,
                        _id: prev._id,
                        id: prev.id,
                        created_at: prev.created_at,
                    }))
                    setIsDirty(true)
                    toaster.create({ title: "Imported from JSON", type: "success" })
                }
            } catch {
                toaster.create({ title: "Invalid file", description: "Couldn't read this file.", type: "error" })
            }
        }
        reader.readAsText(file)
        e.target.value = ""
    }

    const handleExport = () => {
        const parts = MD_SECTIONS.map((s) => sectionToMarkdown(s, agent)).filter(Boolean)
        const md = parts.join("\n\n")
        if (!md) return
        const blob = new Blob([md], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = (agent.name || "agent").replace(/\s+/g, "_") + "_" + new Date().toISOString().split("T")[0].replace(/-/g, "_") + ".md"
        a.click()
        URL.revokeObjectURL(url)
    }

    const copyAgentId = async () => {
        if (!agentId) return
        try {
            await navigator.clipboard.writeText(agentId)
            toaster.create({ title: "Copied agent ID", type: "success" })
        } catch {
            toaster.create({ title: "Couldn't copy", type: "error" })
        }
    }

    const updateAgent = (updates: any) => {
        setAgent((prev: any) => ({ ...prev, ...updates }))
        if (!loading) setIsDirty(true)
    }

    const metaLine = !isNew ? [
        agentId ? `ID ${agentId.slice(0, 10)}` : null,
        agent.created_at ? new Date(agent.created_at).toLocaleDateString() : null,
    ].filter(Boolean).join("  ·  ") : null

    const statusLabel = isDirty ? "Unsaved" : isNew && hasLocalDraft ? "Draft on this device" : "Saved"
    const statusColor = isDirty ? "var(--signal-caution)" : isNew && hasLocalDraft ? "var(--accent-primary)" : "var(--signal-positive)"

    const activePanel = (
        <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
                key={mdStep === step ? `md-${step}` : step}
                custom={dir}
                variants={panelVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: dur.base, ease }}
            >
                {mdStep === step ? (
                    <MarkdownEditorTab
                        md={mdText}
                        onChange={onMdChange}
                        issues={mdIssues}
                        onValidate={runMdValidate}
                        validating={mdValidating}
                        saved={!isDirty}
                        onApply={applySectionMarkdown}
                        applyDisabled={mdIssues.some((i) => i.severity === "error")}
                        applying={mdApplying}
                    />
                ) : step === "overview" ? (
                    <AgentOverview
                        isDirty={isDirty}
                        sections={overviewSections}
                        onNavigate={goTo}
                    />
                ) : step === "configuration" ? (
                    <ConfigurationSection
                        data={agent.configuration}
                        onChange={(v) => updateAgent({ configuration: v })}
                    />
                ) : step === "persona" ? (
                    <PersonaSection
                        data={agent.persona}
                        onChange={(v) => updateAgent({ persona: v })}
                    />
                ) : step === "asset_evaluation" ? (
                    <AssetEvalSection
                        qualitative={agent.asset_evaluation?.qualitative || []}
                        onQualitativeUpdate={(v) => updateAgent({ asset_evaluation: { ...agent.asset_evaluation, qualitative: v } })}
                        quantitative={agent.asset_evaluation?.quantitative || []}
                        onQuantitativeUpdate={(v) => updateAgent({ asset_evaluation: { ...agent.asset_evaluation, quantitative: v } })}
                        id={agentId || ""}
                        name={agent.name}
                        metrics={availableMetrics}
                        persona={agent.persona?.philosophy_and_mindset || ""}
                    />
                ) : (
                    <MacroEvalSection
                        qualitative={agent.macro_evaluation?.qualitative || []}
                        onQualitativeUpdate={(v) => updateAgent({ macro_evaluation: { ...agent.macro_evaluation, qualitative: v } })}
                        quantitative={agent.macro_evaluation?.quantitative || []}
                        onQuantitativeUpdate={(v) => updateAgent({ macro_evaluation: { ...agent.macro_evaluation, quantitative: v } })}
                        id={agentId || ""}
                        name={agent.name}
                        metrics={availableMetrics}
                        persona={agent.persona?.philosophy_and_mindset || ""}
                    />
                )}
            </motion.div>
        </AnimatePresence>
    )

    if (loading) return (
        <Flex justify="center" align="center" minH="60vh">
            <Spinner size="lg" color="var(--accent-primary)" />
        </Flex>
    )

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            style={{ width: "100%" }}
        >
        <Flex
            direction="column" gap={5} pt={2} w="full" maxW="1240px" mx="auto"
        >
            {/* Sticky header — two rows on mobile (name; status + Save), one row on desktop */}
            <Flex
                position="sticky"
                top={0}
                zIndex={10}
                bg="var(--surface-canvas)"
                borderBottom="1px solid var(--hairline)"
                py={2.5}
                direction={{ base: "column", md: "row" }}
                align="stretch"
                justify="space-between"
                gap={2}
            >
                {/* Row 1: name + menu */}
                <Flex align="center" gap={2} minW={0} flex={{ md: 1 }} maxW={{ md: "480px" }}>
                    <AgentAvatar agent={agent} size={40} label={agent.name || "Agent"} />
                    <Flex direction="column" flex={1} minW={0}>
                        <Input
                            variant="subtle"
                            fontWeight={600}
                            fontSize={{ base: "15px", md: "17px" }}
                            value={agent.name}
                            onChange={(e) => { updateAgent({ name: e.target.value }); setNameError(false) }}
                            placeholder="Untitled agent"
                            bg="transparent"
                            border="none"
                            borderBottom={nameError ? "1px solid var(--signal-negative)" : "1px solid var(--hairline)"}
                            borderRadius={0}
                            _focus={{ borderBottomColor: "var(--accent-primary)" }}
                            px={0}
                            py={1}
                            h="auto"
                            minW={0}
                            data-testid="agent-name-input"
                        />
                        {metaLine && (
                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" truncate>
                                {metaLine}
                            </Text>
                        )}
                    </Flex>

                    <Menu.Root>
                        <Menu.Trigger asChild>
                            <Button variant="subtle" size="sm" color="var(--ink-secondary)" px={2} minH="44px" aria-label="More actions">
                                <MdMoreHoriz size={18} />
                            </Button>
                        </Menu.Trigger>
                        <Menu.Positioner>
                            <Menu.Content minW="190px">
                                <Menu.Item value="import" onClick={() => fileInputRef.current?.click()}>
                                    <MdOutlineFileUpload size={15} />
                                    Import Markdown / JSON
                                </Menu.Item>
                                <Menu.Item value="export" onClick={handleExport}>
                                    <MdOutlineFileDownload size={15} />
                                    Export Markdown
                                </Menu.Item>
                                {agentId && (
                                    <>
                                        <Menu.Item value="copyid" onClick={copyAgentId}>
                                            <MdContentCopy size={15} />
                                            Copy agent ID
                                        </Menu.Item>
                                        <Menu.Separator />
                                        <Menu.Item value="delete" color="var(--signal-negative)" onClick={() => setDeleteOpen(true)}>
                                            <MdDeleteForever size={15} />
                                            Delete agent
                                        </Menu.Item>
                                    </>
                                )}
                            </Menu.Content>
                        </Menu.Positioner>
                    </Menu.Root>
                </Flex>

                {/* Row 2 on mobile: status + Draft AI + Save */}
                <Flex
                    align="center"
                    gap={2}
                    flexShrink={0}
                    flexWrap="wrap"
                    justify={{ base: "space-between", md: "flex-end" }}
                    w={{ base: "100%", md: "auto" }}
                >
                    <Flex align="center" gap={1.5} mr={1}>
                        <Box w="7px" h="7px" borderRadius="50%" bg={statusColor} />
                        <Text as="span" fontSize="12px" color={statusColor} fontWeight={500} data-testid="agent-status">
                            {statusLabel}
                        </Text>
                        {saved && (
                            <Text as="span" fontSize="12px" color="var(--signal-positive)" whiteSpace="nowrap" animation="none">
                                Changes saved
                            </Text>
                        )}
                    </Flex>

                    <Button
                        size="sm"
                        variant="subtle"
                        minH="44px"
                        color="var(--accent-primary)"
                        onClick={() => setAiOpen(true)}
                        data-testid="draft-ai-toggle"
                    >
                        <MdOutlineAutoAwesome size={14} />
                        <Box as="span" display={{ base: "none", sm: "inline" }}>Draft with AI</Box>
                    </Button>

                    {!isNew && agentId && (
                        <Flex align="center" gap={2} data-testid="rubric-status">
                            {!rubricLoading && rubric?.status === "approved" ? (
                                <Text as="span" fontSize="12px" fontWeight={600} color="var(--signal-positive)">
                                    Rubric approved
                                </Text>
                            ) : !rubricLoading && rubric?.status === "draft" ? (
                                <>
                                    <Text as="span" fontSize="12px" fontWeight={600} color="var(--signal-caution)">
                                        Rubric draft
                                    </Text>
                                    <Button
                                        size="xs"
                                        variant="subtle"
                                        minH="36px"
                                        color="var(--accent-primary)"
                                        loading={rubricLoading}
                                        onClick={handleApproveRubric}
                                    >
                                        Approve
                                    </Button>
                                </>
                            ) : (
                                !rubricLoading && (
                                    <Button
                                        size="xs"
                                        variant="subtle"
                                        minH="36px"
                                        color="var(--ink-secondary)"
                                        loading={rubricLoading}
                                        onClick={handleCompileRubric}
                                    >
                                        Compile rubric
                                    </Button>
                                )
                            )}
                        </Flex>
                    )}

                    <Button
                        size="sm"
                        variant="surface"
                        colorPalette="blue"
                        px={5}
                        minH="44px"
                        loading={saving}
                        onClick={handleSave}
                        data-testid="agent-save"
                    >
                        <MdSave size={14} />
                        {isNew ? "Create agent" : "Save"}
                    </Button>
                </Flex>
            </Flex>

            {/* Hidden import input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.json"
                style={{ display: "none" }}
                onChange={handleImport}
            />

            {step !== "overview" && (
                <Flex justify="flex-end" mt={-2} mb={-1}>
                    <Button
                        size="xs"
                        variant="subtle"
                        color="var(--ink-secondary)"
                        minH="36px"
                        onClick={toggleMarkdownView}
                        data-testid="mode-toggle"
                    >
                        <MdOutlineFormatAlignLeft size={13} />
                        {mdStep === step ? "Back to form editor" : "View as Markdown"}
                    </Button>
                </Flex>
            )}

            {isMobile ? (
                <Flex direction="column" gap={4}>
                    <MobilePills steps={STEPS} active={step} onSelect={goTo} completion={sectionCompletion} />
                    {activePanel}
                </Flex>
            ) : (
                <Flex direction="row" align="flex-start" gap={8}>
                    <StepRail steps={STEPS} active={step} onSelect={goTo} completion={sectionCompletion} />
                    <Box flex={1} minW={0} pb={10}>
                        {activePanel}
                    </Box>
                </Flex>
            )}

            <DraftWithAiPanel
                open={aiOpen}
                onClose={() => setAiOpen(false)}
                agent={agent}
                agentId={agentId}
                onApply={(proposal) => {
                    const P = proposal as {
                        name?: string;
                        persona?: Record<string, unknown>;
                        persona?: Record<string, unknown>;
                        configuration?: Record<string, unknown>;
                        asset_evaluation?: Record<string, unknown>;
                        macro_evaluation?: Record<string, unknown>;
                    };
                    setAgent((prev: any) => ({
                        ...prev,
                        name: P.name || prev.name,
                        persona: { ...(prev.persona || {}), ...P.persona },
                        configuration: { ...(prev.configuration || {}), ...P.configuration },
                        asset_evaluation: { ...(prev.asset_evaluation || {}), ...P.asset_evaluation },
                        macro_evaluation: { ...(prev.macro_evaluation || {}), ...P.macro_evaluation },
                    }))
                    setIsDirty(true)
                }}
            />

            <ConfirmDialog
                open={restoreOpen}
                title="Restore a draft?"
                message={`A draft of this agent was saved on this device. Restore it and keep editing, or discard it and start from the last saved version.`}
                confirmLabel="Restore draft"
                confirmColorPalette="blue"
                onCancel={discardDraft}
                onConfirm={restoreDraft}
            />

            <ConfirmDialog
                open={navOpen}
                title="Leave with unsaved changes?"
                message={`Your changes to "${agent.name || "this agent"}" may be lost if you leave now.`}
                confirmLabel="Leave"
                confirmColorPalette="blue"
                onCancel={() => { blocker.reset?.(); setNavOpen(false) }}
                onConfirm={() => { blocker.proceed?.(); setNavOpen(false) }}
            />

            <ConfirmDialog
                open={deleteOpen}
                title="Delete agent?"
                message={`"${agent.name || "Untitled agent"}" will be permanently removed and cannot be undone.`}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={confirmDelete}
            />
        </Flex>
        </motion.div>
    )
}
import {
    Text, Flex, Button, Spinner, Input, Box, Menu,
} from "@chakra-ui/react"
import { MdOutlineFileDownload, MdOutlineFileUpload, MdSave, MdDeleteForever, MdMoreHoriz, MdOutlineAutoAwesome, MdEdit } from "react-icons/md"

import { useParams, useNavigate } from "react-router-dom"
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


const DEFAULT_AGENT = {
    name: "",
    id: "",
    _id: "",
    created_at: "",
    source: "",
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
    const [availableMetrics, setAvailableMetrics] = useState<any>(null)
    const [agent, setAgent] = useState<any>({ ...DEFAULT_AGENT })
    const [step, setStep] = useState<string>("overview")
    const [dir, setDir] = useState<number>(1)
    const [isMobile, setIsMobile] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const isNew = urlParams.id === "new"

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

    const fetchMetrics = async () => {
        try {
            const data = await VoyagerService.getAvailableMetrics("NSE")
            if (data?.fields) setAvailableMetrics(data)
        } catch {
            // silently fail
        }
    }

    useEffect(() => {
        fetchAgent()
    }, [urlParams.id])

    useEffect(() => {
        fetchMetrics()
    }, [])

    const VALID_METRIC_TYPES = new Set(["number", "currency", "percentage", "date", "text"])

    const normalizeMetrics = (arr: any[]) =>
        arr?.map((item: any) => ({
            ...item,
            metric_type: VALID_METRIC_TYPES.has(item.metric_type) ? item.metric_type : "number",
        })) ?? []

    const handleSave = async () => {
        if (!agent.name?.trim()) {
            alert("Please enter an agent name before saving.")
            return
        }
        try {
            setSaving(true)
            let agentId = agent.id || agent._id
            if (!agentId) {
                const created = await AgentService.createAgent()
                agentId = created.id || created._id
            }
            const stripIds = (items: any[]) => items?.map(({ id, ...rest }: any) => rest) ?? []
            const dataToSave = {
                _id: agentId,
                name: agent.name,
                source: agent.source,
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
            await AgentService.updateAgent(dataToSave)
            const savedData = await AgentService.readAgent(agentId)
            if (savedData) {
                setAgent((prev: any) => ({
                    ...prev,
                    id: savedData.id || savedData._id || agentId,
                    _id: savedData._id || savedData.id || agentId,
                    name: savedData.name || prev.name,
                    source: savedData.source || prev.source,
                    created_at: savedData.created_at || prev.created_at,
                }))
            }
            setSaved(true)
            setIsDirty(false)
            if (isNew) {
                navigate("/agent/" + agentId, { replace: true })
            }
            setTimeout(() => setSaved(false), 3000)
        } catch (error) {
            console.error("Save Error:", error)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = () => {
        setDeleteOpen(true)
    }

    const confirmDelete = async () => {
        setDeleteOpen(false)
        try {
            await AgentService.deleteAgent(agent.id || agent._id)
            navigate("/agents")
        } catch (error) {
            console.error("Delete Error:", error)
        }
    }

    const handleExport = async () => {
        const agentId = agent.id || agent._id
        if (!agentId) return
        try {
            const data = await AgentService.readAgent(agentId)
            if (!data) return
            const json = JSON.stringify(data, null, "  ")
            const blob = new Blob([json], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = (data.name || "agent").replace(/\s+/g, "_") + "_" + new Date().toISOString().split("T")[0].replace(/-/g, "_") + ".json"
            a.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            console.error("Export Error:", error)
        }
    }

    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string)
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
                    if (data.source) setAvailableMetrics(data.source)
                    setIsDirty(true)
                }
            } catch {
                console.error("Invalid JSON file")
            }
        }
        reader.readAsText(file)
        e.target.value = ""
    }

    const updateAgent = (updates: any) => {
        setAgent((prev: any) => ({ ...prev, ...updates }))
        if (!loading) setIsDirty(true)
    }

    const metaLine = !isNew ? [
        agent.id ? `ID ${(agent._id || agent.id).slice(0, 10)}` : null,
        agent.created_at ? new Date(agent.created_at).toLocaleDateString() : null,
    ].filter(Boolean).join("  ·  ") : null

    const activePanel = (
        <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
                key={step}
                custom={dir}
                variants={panelVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: dur.base, ease }}
            >
                {step === "overview" && (
                    <AgentOverview
                        agentName={agent.name}
                        isDirty={isDirty}
                        sections={overviewSections}
                        onNavigate={goTo}
                    />
                )}
                {step === "configuration" && (
                    <ConfigurationSection
                        data={agent.configuration}
                        onChange={(v) => updateAgent({ configuration: v })}
                    />
                )}
                {step === "persona" && (
                    <PersonaSection
                        data={agent.persona}
                        onChange={(v) => updateAgent({ persona: v })}
                    />
                )}
                {step === "asset_evaluation" && (
                    <AssetEvalSection
                        qualitative={agent.asset_evaluation?.qualitative || []}
                        onQualitativeUpdate={(v) => updateAgent({ asset_evaluation: { ...agent.asset_evaluation, qualitative: v } })}
                        quantitative={agent.asset_evaluation?.quantitative || []}
                        onQuantitativeUpdate={(v) => updateAgent({ asset_evaluation: { ...agent.asset_evaluation, quantitative: v } })}
                        id={agent._id || agent.id}
                        name={agent.name}
                        metrics={availableMetrics}
                        persona={agent.persona?.philosophy_and_mindset || ""}
                    />
                )}
                {step === "macro_evaluation" && (
                    <MacroEvalSection
                        qualitative={agent.macro_evaluation?.qualitative || []}
                        onQualitativeUpdate={(v) => updateAgent({ macro_evaluation: { ...agent.macro_evaluation, qualitative: v } })}
                        quantitative={agent.macro_evaluation?.quantitative || []}
                        onQuantitativeUpdate={(v) => updateAgent({ macro_evaluation: { ...agent.macro_evaluation, quantitative: v } })}
                        id={agent._id || agent.id}
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
        <Flex
            as={motion.div}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            direction="column" gap={5} pt={2} w="full" maxW="1240px" mx="auto"
        >
            {/* Sticky header — one row */}
            <Flex
                position="sticky"
                top={0}
                zIndex={10}
                bg="var(--surface-canvas)"
                borderBottom="1px solid var(--hairline)"
                py={3}
                justify="space-between"
                align="center"
                gap={3}
                flexWrap={{ base: "wrap", md: "nowrap" }}
            >
                <Flex direction="column" flex={1} minW={{ base: "100%", md: "320px" }} maxW={{ base: "100%", md: "440px" }}>
                    <Flex align="center" gap={2} minW={0}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: dur.base, ease }}
                            style={{ display: "flex", color: "var(--ink-tertiary)", flexShrink: 0 }}
                        >
                            <MdEdit size={15} />
                        </motion.div>
                        <Input
                            variant="plain"
                            fontWeight={600}
                            fontSize={{ base: "15px", md: "17px" }}
                            value={agent.name}
                            onChange={(e) => updateAgent({ name: e.target.value })}
                            placeholder="Untitled agent"
                            bg="transparent"
                            border="none"
                            borderBottom="1px solid var(--hairline)"
                            borderRadius={0}
                            _focus={{ borderBottomColor: "var(--accent-primary)" }}
                            px={0}
                            py={1}
                            h="auto"
                            minW={0}
                        />
                    </Flex>
                    {metaLine && (
                        <Text
                            fontSize="11px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            mt={1.5}
                            truncate
                        >
                            {metaLine}
                        </Text>
                    )}
                </Flex>

                <Flex align="center" gap={2} flexShrink={0} flexWrap="wrap" justify={{ base: "space-between", md: "flex-end" }} w={{ base: "100%", md: "auto" }}>
                    <AnimatePresence mode="wait">
                        {isDirty ? (
                            <Flex as={motion.div} key="dirty" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5} mr={1}>
                                <motion.span
                                    animate={{ scale: [1, 1.25, 1] }}
                                    transition={{ repeat: Infinity, repeatDelay: 1.6, duration: dur.slow }}
                                    style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--signal-caution)", display: "inline-block" }}
                                />
                                <Text as="span" fontSize="12px" color="var(--signal-caution)" fontWeight={500} display={{ base: "none", md: "inline" }}>
                                    Unsaved
                                </Text>
                            </Flex>
                        ) : (
                            <Flex as={motion.div} key="clean" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5} mr={1}>
                                <Box w="7px" h="7px" borderRadius="50%" bg="var(--signal-positive)" />
                                <Text as="span" fontSize="12px" color="var(--ink-tertiary)" display={{ base: "none", md: "inline" }}>
                                    Saved
                                </Text>
                            </Flex>
                        )}
                    </AnimatePresence>

                    <Menu.Root>
                        <Menu.Trigger asChild>
                            <Button variant="subtle" size="sm" color="var(--ink-secondary)" px={2} aria-label="More actions">
                                <MdMoreHoriz size={18} />
                            </Button>
                        </Menu.Trigger>
                        <Menu.Positioner>
                            <Menu.Content minW="180px">
                                <Menu.Item
                                    value="import"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <MdOutlineFileUpload size={15} />
                                    Import JSON
                                </Menu.Item>
                                {!isNew && (
                                    <Menu.Item value="export" onClick={handleExport}>
                                        <MdOutlineFileDownload size={15} />
                                        Export JSON
                                    </Menu.Item>
                                )}
                                {!isNew && (
                                    <>
                                        <Menu.Separator />
                                        <Menu.Item
                                            value="delete"
                                            color="var(--signal-negative)"
                                            onClick={handleDelete}
                                        >
                                            <MdDeleteForever size={15} />
                                            Delete agent
                                        </Menu.Item>
                                    </>
                                )}
                            </Menu.Content>
                        </Menu.Positioner>
                    </Menu.Root>

                    {!isNew && (agent._id || agent.id) && (
                        <Button
                            as={motion.button}
                            whileHover={{ y: -1 }}
                            whileTap={{ scale: 0.96 }}
                            size="xs"
                            variant="subtle"
                            color="var(--ink-secondary)"
                            onClick={() => navigate(`/agent/builder/${agent._id || agent.id}`)}
                            fontSize="12px"
                        >
                            <MdOutlineAutoAwesome size={13} color="var(--accent-primary)" />
                            <Box as="span" display={{ base: "none", sm: "inline" }}>
                                Builder Mode
                            </Box>
                        </Button>
                    )}

                    <Button
                        as={motion.button}
                        animate={isDirty ? {
                            boxShadow: [
                                "0 0 0 0 rgba(91, 127, 222, 0)",
                                "0 0 0 4px rgba(91, 127, 222, 0.3)",
                                "0 0 0 0 rgba(91, 127, 222, 0)",
                            ],
                        } : { boxShadow: "0 0 0 0 rgba(91, 127, 222, 0)" }}
                        transition={isDirty ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
                        whileTap={{ scale: 0.97 }}
                        whileHover={{ y: -1 }}
                        size="sm"
                        variant="surface"
                        colorPalette="blue"
                        px={5}
                        loading={saving}
                        onClick={handleSave}
                    >
                        <MdSave size={14} />
                        {isNew ? "Create agent" : "Save"}
                    </Button>

                    <AnimatePresence>
                        {saved && (
                            <Text
                                as={motion.span}
                                initial={{ opacity: 0, x: 8 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 8 }}
                                transition={{ duration: dur.base, ease }}
                                fontSize="12px"
                                color="var(--signal-positive)"
                                display={{ base: "none", md: "inline" }}
                                whiteSpace="nowrap"
                            >
                                Changes saved
                            </Text>
                        )}
                    </AnimatePresence>
                </Flex>
            </Flex>

            {/* Hidden import input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImport}
            />

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

            <ConfirmDialog
                open={deleteOpen}
                title="Delete agent?"
                message={`"${agent.name || "Untitled agent"}" will be permanently removed and cannot be undone.`}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={confirmDelete}
            />
        </Flex>
    )
}

import {
    Text, Flex, Button, Spinner, Input, Box,
} from "@chakra-ui/react"
import { MdOutlineFileDownload, MdOutlineFileUpload, MdSave, MdDeleteForever } from "react-icons/md"

import { useParams, useNavigate } from "react-router-dom"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { ProfileService, VoyagerService } from "@/db"

import { DesktopSidebar, MobilePills } from "./ProfileSidebarNav"
import ProfileOverview from "./ProfileOverview"
import SectionBlock from "./shared/SectionBlock"
import PersonaSection from "./sections/PersonaSection"
import ConfigurationSection from "./sections/ConfigurationSection"
import AssetEvalSection from "./sections/AssetEvalSection"
import MacroEvalSection from "./sections/MacroEvalSection"


const DEFAULT_PROFILE = {
    name: "",
    id: "",
    _id: "",
    created_at: "",
    source: "",
    persona: {
        philosophy_and_mindset: "",
    },
    configuration: {
        market_options: [],
        asset_class: [],
        universe_cap: [],
        universe_sector: [],
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

function getFirstSubsection(section: string): string | null {
    const map: Record<string, string[]> = {
        configuration: ["market_options", "asset_class", "universe_cap", "universe_sector"],
        persona: ["philosophy_and_mindset"],
        asset_evaluation: ["qualitative", "quantitative"],
        macro_evaluation: ["qualitative", "quantitative"],
    }
    const subs = map[section]
    return subs ? subs[0] : null
}

function computeSubsectionCompletion(profile: any): Record<string, boolean> {
    const c = profile.configuration || {}
    const ae = profile.asset_evaluation || {}
    const me = profile.macro_evaluation || {}

    return {
        "configuration/market_options": c.market_options?.length > 0,
        "configuration/asset_class": c.asset_class?.length > 0,
        "configuration/universe_cap": c.universe_cap?.length > 0,
        "configuration/universe_sector": c.universe_sector?.length > 0,
        "persona/philosophy_and_mindset": !!profile.persona?.philosophy_and_mindset,
        "asset_evaluation/qualitative": ae.qualitative?.length > 0,
        "asset_evaluation/quantitative": ae.quantitative?.length > 0,
        "macro_evaluation/qualitative": me.qualitative?.length > 0,
        "macro_evaluation/quantitative": me.quantitative?.length > 0,
    }
}

function computeSectionCompletion(profile: any): Record<string, boolean> {
    return {
        overview: true,
        configuration: !!(
            profile.configuration?.market_options?.length ||
            profile.configuration?.asset_class?.length ||
            profile.configuration?.universe_cap?.length ||
            profile.configuration?.universe_sector?.length
        ),
        persona: !!(profile.persona?.philosophy_and_mindset),
        asset_evaluation: !!((profile.asset_evaluation?.qualitative?.length > 0) || (profile.asset_evaluation?.quantitative?.length > 0)),
        macro_evaluation: !!((profile.macro_evaluation?.qualitative?.length > 0) || (profile.macro_evaluation?.quantitative?.length > 0)),
    }
}

function computeOverviewSections(profile: any): { id: string; label: string; summary: string; hasContent: boolean }[] {
    const c = profile.configuration || {}
    const ae = profile.asset_evaluation || {}
    const me = profile.macro_evaluation || {}

    return [
        {
            id: "configuration",
            label: "Configuration",
            summary: [
                c.market_options?.length ? `${c.market_options.length} markets` : "",
                c.asset_class?.length ? `${c.asset_class.length} asset classes` : "",
                c.universe_cap?.length ? `${c.universe_cap.length} cap sizes` : "",
                c.universe_sector?.length ? `${c.universe_sector.length} sectors` : "",
            ].filter(Boolean).join(" · ") || "Not configured",
            hasContent: !!(c.market_options?.length || c.asset_class?.length || c.universe_cap?.length || c.universe_sector?.length),
        },
        {
            id: "persona",
            label: "Investor Persona",
            summary: profile.persona?.philosophy_and_mindset ? "Philosophy & mindset written" : "No content yet",
            hasContent: !!profile.persona?.philosophy_and_mindset,
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

export default function Profile() {
    const urlParams = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [availableMetrics, setAvailableMetrics] = useState<any>(null)
    const [metricsSource, setMetricsSource] = useState<string>("NSE")
    const [profile, setProfile] = useState<any>({ ...DEFAULT_PROFILE })
    const [visibleSection, setVisibleSection] = useState<string>("overview")
    const [visibleSubsection, setVisibleSubsection] = useState<string | null>(null)
    const [isMobile, setIsMobile] = useState(false)

    const isNew = urlParams.id === "new"

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768)
        check()
        window.addEventListener("resize", check)
        return () => window.removeEventListener("resize", check)
    }, [])

    const sectionCompletion = useMemo(() => computeSectionCompletion(profile), [profile])
    const subsectionCompletion = useMemo(() => computeSubsectionCompletion(profile), [profile])
    const overviewSections = useMemo(() => computeOverviewSections(profile), [profile])

    const fetchProfile = async () => {
        try {
            if (urlParams.id && !isNew) {
                const data = await ProfileService.readProfile(urlParams.id)
                if (data) {
                    setProfile({
                        name: data.name || "",
                        id: data.id || data._id || "",
                        _id: data._id || data.id || "",
                        created_at: data.created_at || "",
                        source: data.source || "",
                        persona: data.persona ?? DEFAULT_PROFILE.persona,
                        configuration: data.configuration ?? DEFAULT_PROFILE.configuration,
                        asset_evaluation: {
                            qualitative: data.asset_evaluation?.qualitative ?? data.qualitative ?? [],
                            quantitative: data.asset_evaluation?.quantitative ?? [],
                        },
                        macro_evaluation: {
                            qualitative: data.macro_evaluation?.qualitative ?? [],
                            quantitative: data.macro_evaluation?.quantitative ?? [],
                        },
                    })
                    if (data.source) setMetricsSource(data.source)
                    setIsDirty(false)
                }
            } else {
                setProfile({ ...DEFAULT_PROFILE })
                setIsDirty(true)
                setTimeout(() => handleScrollTo("persona", "philosophy_and_mindset"), 100)
            }
        } catch (error) {
            console.error("API Error:", error)
        } finally {
            setLoading(false)
        }
    }

    const fetchMetrics = async (source: string) => {
        if (!source) {
            setAvailableMetrics(null)
            return
        }
        try {
            const data = await VoyagerService.getAvailableMetrics(source)
            if (data?.categories) setAvailableMetrics(data)
        } catch {
            // silently fail
        }
    }

    useEffect(() => {
        fetchProfile()
    }, [urlParams.id])

    useEffect(() => {
        if (!isNew || metricsSource) {
            fetchMetrics(metricsSource)
        }
    }, [metricsSource])

    useEffect(() => {
        const elements = document.querySelectorAll("[data-section]")
        if (elements.length === 0) return

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

                if (visible.length > 0) {
                    const top = visible[0]
                    const section = top.target.getAttribute("data-section") || "overview"
                    const subsection = top.target.getAttribute("data-subsection") || null
                    setVisibleSection(section)
                    setVisibleSubsection(subsection)
                }
            },
            { rootMargin: "-80px 0px -60% 0px" }
        )

        elements.forEach((el) => observer.observe(el))
        return () => observer.disconnect()
    }, [loading, profile])

    const handleScrollTo = useCallback((section: string, subsection?: string | null) => {
        const selector = subsection
            ? `[data-section="${section}"][data-subsection="${subsection}"]`
            : `[data-section="${section}"]:not([data-subsection])`
        const el = document.querySelector(selector)
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" })
        }
    }, [])

    const VALID_METRIC_TYPES = new Set(["number", "currency", "percentage", "date", "text"])

    const normalizeMetrics = (arr: any[]) =>
        arr?.map((item: any) => ({
            ...item,
            metric_type: VALID_METRIC_TYPES.has(item.metric_type) ? item.metric_type : "number",
        })) ?? []

    const handleSave = async () => {
        if (!profile.name?.trim()) {
            alert("Please enter a profile name before saving.")
            return
        }
        try {
            setSaving(true)
            let profileId = profile.id || profile._id
            if (!profileId) {
                const created = await ProfileService.createProfile()
                profileId = created.id || created._id
            }
            const stripIds = (items: any[]) => items?.map(({ id, ...rest }: any) => rest) ?? []
            const dataToSave = {
                _id: profileId,
                name: profile.name,
                source: profile.source,
                persona: profile.persona,
                configuration: profile.configuration,
                asset_evaluation: {
                    qualitative: stripIds(profile.asset_evaluation?.qualitative),
                    quantitative: normalizeMetrics(profile.asset_evaluation?.quantitative),
                },
                macro_evaluation: {
                    qualitative: stripIds(profile.macro_evaluation?.qualitative),
                    quantitative: normalizeMetrics(profile.macro_evaluation?.quantitative),
                },
            }
            await ProfileService.updateProfile(dataToSave)
            const savedData = await ProfileService.readProfile(profileId)
            if (savedData) {
                setProfile((prev: any) => ({
                    ...prev,
                    id: savedData.id || savedData._id || profileId,
                    _id: savedData._id || savedData.id || profileId,
                    name: savedData.name || prev.name,
                    source: savedData.source || prev.source,
                    created_at: savedData.created_at || prev.created_at,
                }))
            }
            setSaved(true)
            setIsDirty(false)
            if (isNew) {
                navigate("/profile/" + profileId, { replace: true })
            }
            setTimeout(() => setSaved(false), 3000)
        } catch (error) {
            console.error("Save Error:", error)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (confirm(`Are you sure you want to delete the profile "${profile.name}"?`)) {
            try {
                await ProfileService.deleteProfile(profile.id || profile._id)
                navigate("/profiles")
            } catch (error) {
                console.error("Delete Error:", error)
            }
        }
    }

    const handleExport = async () => {
        const profileId = profile.id || profile._id
        if (!profileId) return
        try {
            const data = await ProfileService.readProfile(profileId)
            if (!data) return
            const json = JSON.stringify(data, null, "  ")
            const blob = new Blob([json], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = (data.name || "profile").replace(/\s+/g, "_") + "_" + new Date().toISOString().split("T")[0].replace(/-/g, "_") + ".json"
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
                    setProfile((prev: any) => ({
                        ...prev,
                        ...data,
                        _id: prev._id,
                        id: prev.id,
                        created_at: prev.created_at,
                    }))
                    if (data.source) setMetricsSource(data.source)
                    setIsDirty(true)
                }
            } catch {
                console.error("Invalid JSON file")
            }
        }
        reader.readAsText(file)
        e.target.value = ""
    }

    const handleSourceChange = (newSource: string) => {
        setProfile((prev: any) => ({ ...prev, source: newSource }))
        setMetricsSource(newSource)
        if (!loading) setIsDirty(true)
    }

    const updateProfile = (updates: any) => {
        setProfile((prev: any) => ({ ...prev, ...updates }))
        if (!loading) setIsDirty(true)
    }

    const overviewNavigate = (section: string) => {
        const first = getFirstSubsection(section)
        handleScrollTo(section, first)
    }

    const renderedSections = (
        <>
            <SectionBlock sectionId="overview" title="Overview" description="">
                <ProfileOverview
                    profileName={profile.name}
                    isDirty={isDirty}
                    sections={overviewSections}
                    onNavigate={overviewNavigate}
                />
            </SectionBlock>

            <ConfigurationSection
                data={profile.configuration}
                onChange={(v) => updateProfile({ configuration: v })}
            />

            <PersonaSection
                data={profile.persona}
                onChange={(v) => updateProfile({ persona: v })}
            />

            <AssetEvalSection
                qualitative={profile.asset_evaluation?.qualitative || []}
                onQualitativeUpdate={(v) => updateProfile({ asset_evaluation: { ...profile.asset_evaluation, qualitative: v } })}
                quantitative={profile.asset_evaluation?.quantitative || []}
                onQuantitativeUpdate={(v) => updateProfile({ asset_evaluation: { ...profile.asset_evaluation, quantitative: v } })}
                id={profile._id || profile.id}
                name={profile.name}
                metrics={availableMetrics}
                source={profile.source}
                onSourceChange={handleSourceChange}
            />

            <MacroEvalSection
                qualitative={profile.macro_evaluation?.qualitative || []}
                onQualitativeUpdate={(v) => updateProfile({ macro_evaluation: { ...profile.macro_evaluation, qualitative: v } })}
                quantitative={profile.macro_evaluation?.quantitative || []}
                onQuantitativeUpdate={(v) => updateProfile({ macro_evaluation: { ...profile.macro_evaluation, quantitative: v } })}
                id={profile._id || profile.id}
                name={profile.name}
                metrics={availableMetrics}
                source={profile.source}
            />
        </>
    )

    if (loading) return (
        <Flex justify="center" align="center" minH="60vh">
            <Spinner size="lg" borderWidth="2px" color="var(--ink-secondary)" />
        </Flex>
    )

    const metaLine = !isNew ? [
        profile._id || profile.id ? `ID ${(profile._id || profile.id).slice(0, 10)}` : null,
        profile.created_at ? new Date(profile.created_at).toLocaleDateString() : null,
        profile.source || null,
    ].filter(Boolean).join("  ·  ") : null

    return (
        <Flex direction="column" gap={6} pt={4} bg="var(--surface-canvas)" minH="100vh">
            {/* Sticky header */}
            <Flex
                position="sticky"
                top={0}
                zIndex={10}
                bg="var(--surface-canvas)"
                borderBottom="1px solid var(--hairline)"
                pb={4}
                pt={4}
                direction="column"
                gap={3}
            >
                <Flex justify="space-between" align="start">
                    <Flex direction="column" gap={1} flex={1} maxW="400px">
                        <Input
                            variant="plain"
                            fontWeight={600}
                            fontSize="18px"
                            value={profile.name}
                            onChange={(e) => updateProfile({ name: e.target.value })}
                            placeholder="Profile name"
                            bg="transparent"
                            border="none"
                            borderBottom="1px solid var(--hairline)"
                            borderRadius={0}
                            _focus={{ borderBottomColor: "var(--accent-primary)" }}
                            px={0}
                            py={2}
                            h="auto"
                        />
                        {metaLine && (
                            <Text
                                fontSize="11.5px"
                                fontFamily="var(--font-mono)"
                                color="var(--ink-tertiary)"
                                mt={1}
                            >
                                {metaLine}
                            </Text>
                        )}
                        {isDirty ? (
                            <Text fontSize="12px" color="var(--ink-tertiary)" mt={1}>
                                Unsaved changes
                            </Text>
                        ) : (
                            <Text fontSize="12px" color="var(--ink-tertiary)" mt={1}>
                                All changes saved
                            </Text>
                        )}
                    </Flex>

                    <Flex direction="column" align="flex-end" gap={2} pt={4}>
                        <Flex gap={2}>
                            {!isNew && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    color="var(--ink-tertiary)"
                                    _hover={{ color: "var(--signal-negative)", bg: "transparent" }}
                                    onClick={handleDelete}
                                    fontWeight={500}
                                >
                                    <MdDeleteForever size={16} style={{ marginRight: 4 }} />
                                    Delete
                                </Button>
                            )}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                style={{ display: "none" }}
                                onChange={handleImport}
                            />
                            {!isNew && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    color="var(--ink-tertiary)"
                                    _hover={{ color: "var(--ink-primary)", bg: "transparent" }}
                                    onClick={handleExport}
                                    fontWeight={500}
                                >
                                    <MdOutlineFileDownload size={16} style={{ marginRight: 4 }} />
                                    Export
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                color="var(--ink-tertiary)"
                                _hover={{ color: "var(--ink-primary)", bg: "transparent" }}
                                onClick={() => fileInputRef.current?.click()}
                                fontWeight={500}
                            >
                                <MdOutlineFileUpload size={16} style={{ marginRight: 4 }} />
                                Import
                            </Button>

                            <Button
                                size="sm"
                                bg="var(--accent-primary)"
                                color="#fff"
                                fontWeight={500}
                                fontSize="13px"
                                px={5}
                                _hover={{ opacity: 0.9 }}
                                borderRadius="3px"
                                loading={saving}
                                onClick={handleSave}
                            >
                                <MdSave size={14} style={{ marginRight: 4 }} />
                                {isNew ? "Create" : "Save"}
                            </Button>
                        </Flex>
                        {saved && (
                            <Text fontSize="12px" color="var(--signal-positive)">
                                Changes saved
                            </Text>
                        )}
                    </Flex>
                </Flex>
            </Flex>

            {isMobile ? (
                <Flex direction="column" gap={4}>
                    <MobilePills
                        visibleSection={visibleSection}
                        visibleSubsection={visibleSubsection}
                        onScrollTo={handleScrollTo}
                        sectionCompletion={sectionCompletion}
                        subsectionCompletion={subsectionCompletion}
                    />
                    {renderedSections}
                </Flex>
            ) : (
                <Flex direction="row" align="stretch" gap={8}>
                    <DesktopSidebar
                        visibleSection={visibleSection}
                        visibleSubsection={visibleSubsection}
                        onScrollTo={handleScrollTo}
                        sectionCompletion={sectionCompletion}
                        subsectionCompletion={subsectionCompletion}
                    />
                    <Box flex={1} minW={0}>
                        {renderedSections}
                    </Box>
                </Flex>
            )}
        </Flex>
    )
}

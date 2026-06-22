import {
    Text,
    Flex,
    Button,
    Spinner,
    Input,
    Box,
    Tabs,
} from "@chakra-ui/react"
import { MdOutlineFileDownload, MdSave, MdDeleteForever } from "react-icons/md";

import { useParams, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { ProfileService, VoyagerService } from "@/db";

import ProfileDataQualitative from "./ProfileQualitative"
import ProfileQuantitative from "./ProfileQuantitative"


export default function Profile() {

    const urlParams = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [availableMetrics, setAvailableMetrics] = useState<any>(null)
    const [metricsSource, setMetricsSource] = useState<string>("NSE")
    const [profile, setProfile] = useState<any>({
        name: "",
        id: "",
        created_at: "",
        source: "",
        qualitative: [],
        quantitative: [],
    })

    const isNew = urlParams.id === "new";

    const fetchProfile = async () => {
        try {
            if (urlParams.id && !isNew) {
                const data = await ProfileService.readProfile(urlParams.id);
                if (data) {
                    setProfile({
                        name: data.name || "",
                        id: data.id || data._id || "",
                        _id: data._id || data.id || "",
                        created_at: data.created_at || "",
                        source: data.source || "",
                        qualitative: data.qualitative || [],
                        quantitative: data.quantitative || [],
                    });
                    if (data.source) setMetricsSource(data.source);
                    setIsDirty(false);
                }
            } else {
                setProfile({
                    name: "",
                    id: "",
                    _id: "",
                    created_at: "",
                    source: "",
                    qualitative: [],
                    quantitative: [],
                });
                setIsDirty(true);
            }
        } catch (error) {
            console.error("API Error:", error);
        } finally {
            setLoading(false)
        }
    }

    const fetchMetrics = async (source: string) => {
        if (!source) {
            setAvailableMetrics(null);
            return;
        }
        try {
            const data = await VoyagerService.getAvailableMetrics(source);
            if (data?.categories) setAvailableMetrics(data);
        } catch {
            // silently fail
        }
    }

    useEffect(() => {
        fetchProfile();
    }, [urlParams.id]);

    useEffect(() => {
        if (!isNew || metricsSource) {
            fetchMetrics(metricsSource);
        }
    }, [metricsSource]);

    const handleSave = async () => {
        try {
            setSaving(true);
            let profileId = profile.id || profile._id;
            if (!profileId) {
                const created = await ProfileService.createProfile();
                profileId = created.id || created._id;
            }
            const dataToSave = {
                id: profileId,
                name: profile.name,
                source: profile.source,
                qualitative: profile.qualitative,
                quantitative: profile.quantitative,
            };
            await ProfileService.updateProfile(dataToSave);
            const saved = await ProfileService.readProfile(profileId);
            if (saved) {
                setProfile((prev: any) => ({
                    ...prev,
                    id: saved.id || saved._id || profileId,
                    _id: saved._id || saved.id || profileId,
                    name: saved.name || prev.name,
                    source: saved.source || prev.source,
                    qualitative: saved.qualitative || prev.qualitative,
                    quantitative: saved.quantitative || prev.quantitative,
                    created_at: saved.created_at || prev.created_at,
                }));
            }
            setSaved(true);
            setIsDirty(false);
            if (isNew) {
                navigate("/profile/" + profileId, { replace: true });
            }
            setTimeout(() => setSaved(false), 3000);
        } catch (error) {
            console.error("Save Error:", error);
        } finally {
            setSaving(false);
        }
    }

    const handleDelete = async () => {
        if (confirm(`Are you sure you want to delete the profile "${profile.name}"?`)) {
            try {
                await ProfileService.deleteProfile(profile.id || profile._id);
                navigate("/profiles");
            } catch (error) {
                console.error("Delete Error:", error);
            }
        }
    }

    const handleExport = async () => {
        const profileId = profile.id || profile._id;
        if (!profileId) return;
        try {
            const data = await ProfileService.readProfile(profileId);
            if (!data) return;
            const json = JSON.stringify(data, null, "  ");
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = (data.name || "profile").replace(/\s+/g, "_") + "_" + new Date().toISOString().split("T")[0].replace(/-/g, "_") + ".json";
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export Error:", error);
        }
    }

    const handleSourceChange = (newSource: string) => {
        setProfile((prev: any) => ({ ...prev, source: newSource }));
        setMetricsSource(newSource);
        if (!loading) setIsDirty(true);
    };

    const updateProfile = (updates: any) => {
        setProfile((prev: any) => ({ ...prev, ...updates }));
        if (!loading) setIsDirty(true);
    };

    if (loading) return <Spinner />;

    return (

        <Flex direction={"column"} gap={10}>
            <Flex justify="space-between" align="start" borderBottom="1px solid" borderColor="border" pb={8}>

                <Flex direction="column" gap={1} flex={1} maxW="400px">
                    <Text fontSize="xs" fontWeight="bold" color="fg.muted" letterSpacing="widest" mb={1}>PROFILE NAME</Text>
                    <Input
                        variant="subtle"
                        fontWeight="bold"
                        fontSize="lg"
                        value={profile.name}
                        onChange={(e) => updateProfile({ name: e.target.value })}
                        bg="bg.muted"
                        _focus={{ bg: "bg.subtle", borderColor: "border.emphasized" }}
                        px={3}
                        py={4}
                        h="auto"
                        rounded="sm"
                    />
                    {saved && <Text color="green.600" fontSize="xs" fontWeight="bold" mt={2}>Changes saved successfully</Text>}
                </Flex>

                <Flex direction="column" align="flex-end" gap={4} pt={6}>
                    <Flex gap={3}>
                        {!isNew && (
                            <Button
                                variant="ghost"
                                color="fg.subtle"
                                _hover={{ color: "red.500", bg: "transparent" }}
                                onClick={handleDelete}
                                size="sm"
                                fontWeight="bold"
                            >
                                <MdDeleteForever size={18} />
                                DELETE
                            </Button>
                        )}

                        {!isNew && (
                            <Button variant="outline" size="sm" color="fg.muted" borderColor="border" _hover={{ bg: "bg.muted", color: "fg" }} onClick={handleExport}>
                                <MdOutlineFileDownload />
                                EXPORT JSON
                            </Button>
                        )}

                        <Button
                            variant="subtle"
                            colorPalette="gray"
                            loading={saving}
                            onClick={handleSave}
                            size="sm"
                            px={6}
                            bg={isDirty ? "blue.800" : "bg.emphasized"}
                            color="fg"
                            _hover={{ bg: isDirty ? "blue.700" : "border.emphasized" }}
                            border="1px solid"
                            borderColor={isDirty ? "blue.600" : "transparent"}
                        >
                            <MdSave />
                            {isNew ? "CREATE PROFILE" : "SAVE PROFILE"}
                        </Button>
                    </Flex>
                    {isDirty && (
                        <Flex align="center" gap={2} bg="orange.900/20" color="orange.500" px={3} py={1} rounded="sm" border="1px solid" borderColor="orange.900/50">
                            <Text fontSize="2xs" fontWeight="bold" letterSpacing="widest">UNSAVED CHANGES DETECTED</Text>
                        </Flex>
                    )}
                </Flex>
            </Flex>

            <Tabs.Root defaultValue="qualitative" variant="line">
                <Tabs.List borderColor="border">
                    <Tabs.Trigger
                        value="qualitative"
                        color="fg.subtle"
                        _selected={{ color: "fg", borderColor: "blue.500" }}
                        fontSize="sm"
                        fontWeight="bold"
                        px={6}
                        py={3}
                    >
                        I. QUALITATIVE PARAMETERS
                    </Tabs.Trigger>
                    <Tabs.Trigger
                        value="quantitative"
                        color="fg.subtle"
                        _selected={{ color: "fg", borderColor: "blue.500" }}
                        fontSize="sm"
                        fontWeight="bold"
                        px={6}
                        py={3}
                    >
                        II. QUANTITATIVE CRITERIA
                    </Tabs.Trigger>
                    <Tabs.Indicator bg="blue.500" />
                </Tabs.List>

                <Tabs.Content value="qualitative" pt={6}>
                    <ProfileDataQualitative
                        name={profile.name}
                        data={profile.qualitative}
                        id={profile._id || profile.id}
                        metrics={availableMetrics}
                        onUpdate={(newData: any) => updateProfile({ qualitative: newData })}
                    />
                </Tabs.Content>

                <Tabs.Content value="quantitative" pt={6}>
                    <ProfileQuantitative
                        name={profile.name}
                        data={profile.quantitative}
                        id={profile._id || profile.id}
                        metrics={availableMetrics}
                        source={profile.source}
                        onSourceChange={handleSourceChange}
                        onUpdate={(newData: any) => updateProfile({ quantitative: newData })}
                    />
                </Tabs.Content>
            </Tabs.Root>
        </Flex>
    )
}
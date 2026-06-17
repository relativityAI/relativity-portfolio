import {
    Text,
    DownloadTrigger,
    Flex,
    Button,
    Spinner,
    Input,
    Box
} from "@chakra-ui/react"
import { MdOutlineFileDownload, MdSave, MdDeleteForever } from "react-icons/md";

import { useParams, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { ProfileService } from "@/db";

import ProfileDataQualitative from "./ProfileQualitative"
import ProfileDataSources from "./ProfileDataSources"


export default function Profile() {

    const urlParams = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [profile, setProfile] = useState<any>({
        name: "",
        id: "",
        created_at: "",
        qualitative: [],
        data_sources: []
    })

    const fetchProfile = async () => {
        try {
            if (urlParams.id) {
                const data = await ProfileService.readProfile(urlParams.id);
                if (data) {
                    setProfile(data);
                    setIsDirty(false); // Reset on initial load
                }
            }
        } catch (error) {
            console.error("API Error:", error);
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchProfile();
    }, [urlParams.id]);

    const handleSave = async () => {
        try {
            setSaving(true);
            const dataToSave = {
                id: profile.id,
                name: profile.name,
                qualitative: profile.qualitative,
                data_sources: profile.data_sources
            };
            await ProfileService.updateProfile(dataToSave);
            setSaved(true);
            setIsDirty(false); // Reset on success
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
                await ProfileService.deleteProfile(profile.id);
                navigate("/profiles");
            } catch (error) {
                console.error("Delete Error:", error);
            }
        }
    }

    const updateProfile = (updates: any) => {
        setProfile((prev: any) => ({ ...prev, ...updates }));
        if (!loading) setIsDirty(true);
    };

    if (loading) return <Spinner />;

    return (

        <Flex direction={"column"} gap={10}>
            <Flex justify="space-between" align="start" borderBottom="1px solid" borderColor="gray.800" pb={8}>

                <Flex direction="column" gap={1} flex={1} maxW="400px">
                    <Text fontSize="xs" fontWeight="bold" color="gray.600" letterSpacing="widest" mb={1}>PROFILE NAME</Text>
                    <Input
                        variant="subtle"
                        fontWeight="bold"
                        fontSize="lg"
                        value={profile.name}
                        onChange={(e) => updateProfile({ name: e.target.value })}
                        bg="gray.900"
                        _focus={{ bg: "gray.950", borderColor: "gray.700" }}
                        px={3}
                        py={4}
                        h="auto"
                        rounded="sm"
                    />
                    {saved && <Text color="green.600" fontSize="xs" fontWeight="bold" mt={2}>Changes saved successfully</Text>}
                </Flex>

                <Flex direction="column" align="flex-end" gap={4} pt={6}>
                    <Flex gap={3}>
                        <Button
                            variant="ghost"
                            color="gray.500"
                            _hover={{ color: "red.500", bg: "transparent" }}
                            onClick={handleDelete}
                            size="sm"
                            fontWeight="bold"
                        >
                            <MdDeleteForever size={18} />
                            DELETE
                        </Button>

                        <DownloadTrigger
                            data={JSON.stringify(profile, null, "  ")}
                            fileName={profile.name.replace(/\s+/g, "_") + "_" + (new Date()).toISOString().split("T")[0].replace(/-/g, "_") + ".json"}
                            mimeType="application/json"
                            asChild
                        >
                            <Button variant="outline" size="sm" color="gray.400" borderColor="gray.800" _hover={{ bg: "gray.900", color: "white" }}>
                                <MdOutlineFileDownload />
                                EXPORT JSON
                            </Button>
                        </DownloadTrigger>

                        <Button
                            variant="subtle"
                            colorPalette="gray"
                            loading={saving}
                            onClick={handleSave}
                            size="sm"
                            px={6}
                            bg={isDirty ? "blue.800" : "gray.800"}
                            color="white"
                            _hover={{ bg: isDirty ? "blue.700" : "gray.700" }}
                            border="1px solid"
                            borderColor={isDirty ? "blue.600" : "transparent"}
                        >
                            <MdSave />
                            SAVE PROFILE
                        </Button>
                    </Flex>
                    {isDirty && (
                        <Flex align="center" gap={2} bg="orange.900/20" color="orange.500" px={3} py={1} rounded="sm" border="1px solid" borderColor="orange.900/50">
                            <Text fontSize="2xs" fontWeight="bold" letterSpacing="widest">UNSAVED CHANGES DETECTED</Text>
                        </Flex>
                    )}
                </Flex>
            </Flex>

            <Flex direction={{ base: "column", xl: "row" }} gap={12} align="start">
                {/* Left Column: Qualitative (50%) */}
                <Box flex="1" width="full">
                    <Text fontSize="xs" fontWeight="black" color="gray.600" letterSpacing="widest" mb={6}>I. QUALITATIVE PARAMETERS</Text>
                    <ProfileDataQualitative
                        name={profile.name}
                        data={profile.qualitative}
                        id={profile._id}
                        onUpdate={(newData: any) => updateProfile({ qualitative: newData })}
                    />
                </Box>

                {/* Right Column: Data Sources (50%) */}
                <Box flex="1" width="full" borderLeft={{ base: "none", xl: "1px solid" }} borderColor="gray.800" pl={{ base: 0, xl: 12 }}>
                    <Text fontSize="xs" fontWeight="black" color="gray.600" letterSpacing="widest" mb={6}>II. DATA SOURCES CONFIGURATION</Text>
                    <ProfileDataSources
                        name={profile.name}
                        data={profile.data_sources}
                        id={profile._id}
                        onUpdate={(newData: any) => updateProfile({ data_sources: newData })}
                    />
                </Box>
            </Flex>
        </Flex>
    )
}

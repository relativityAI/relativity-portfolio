import {
    Tabs,
    Text,
    FormatByte,
    DownloadTrigger,
    Flex,
    Button,
    Spinner,
    DataList,
    Input
} from "@chakra-ui/react"
import { LuSquareCheck, LuUser } from "react-icons/lu"
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

    if (loading) return <Spinner />;

    return (

        <Flex direction={"column"} gap={6}>
            <Flex justify="space-between" align="center">

                <Flex direction="column" gap={1}>
                    <DataList.Root size="lg" orientation="horizontal">
                        <DataList.Item>
                            <DataList.ItemLabel>Profile Name</DataList.ItemLabel>
                            <DataList.ItemValue>
                                <Input
                                    variant={"flushed"}
                                    fontWeight="bold"
                                    fontSize="xl"
                                    value={profile.name}
                                    onChange={(e) => { setProfile({ ...profile, name: e.target.value }) }}
                                />
                            </DataList.ItemValue>
                        </DataList.Item>
                    </DataList.Root>
                    {saved && <Text color="green.500" fontSize="sm" fontWeight="bold">Saved successfully!</Text>}
                </Flex>

                <Flex gap={3}>
                    <Button
                        colorPalette="red"
                        variant="outline"
                        onClick={handleDelete}
                    >
                        <MdDeleteForever />
                        Delete
                    </Button>

                    <Button
                        colorPalette="blue"
                        loading={saving}
                        onClick={handleSave}
                    >
                        <MdSave />
                        Save Profile
                    </Button>

                    <DownloadTrigger
                        data={JSON.stringify(profile, null, "  ")}
                        fileName={profile.name + "-" + (new Date()).toISOString().split("T")[0] + ".json"}
                        mimeType="application/json"
                        asChild
                    >
                        <Button variant="outline">
                            <MdOutlineFileDownload />
                            Export
                            (<FormatByte value={JSON.stringify(profile, null, "  ").length} unitDisplay="narrow" />)
                        </Button>
                    </DownloadTrigger>
                </Flex>
            </Flex>

            <Flex direction={"column"} gap={4}>
                <Tabs.Root defaultValue="qualitative">
                    <Tabs.List>
                        <Tabs.Trigger value="qualitative">
                            <LuUser />
                            Qualitative Parameters ({profile.qualitative?.length || 0})
                        </Tabs.Trigger>
                        <Tabs.Trigger value="data-sources">
                            <LuSquareCheck />
                            Data Sources ({profile.data_sources?.length || 0})
                        </Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="qualitative">
                        <ProfileDataQualitative
                            name={profile.name}
                            data={profile.qualitative}
                            id={profile._id}
                            onUpdate={(newData: any) => setProfile({ ...profile, qualitative: newData })}
                        />
                    </Tabs.Content>

                    <Tabs.Content value="data-sources">
                        <ProfileDataSources
                            name={profile.name}
                            data={profile.data_sources}
                            id={profile._id}
                            onUpdate={(newData: any) => setProfile({ ...profile, data_sources: newData })}
                        />
                    </Tabs.Content>
                </Tabs.Root>
            </Flex>
        </Flex>
    )
}

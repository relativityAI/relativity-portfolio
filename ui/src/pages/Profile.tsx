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
import { MdOutlineFileDownload, MdDeleteForever } from "react-icons/md";

import axios from "axios"
import { useParams } from "react-router-dom"
import { useState, useEffect, useMemo } from "react"

import ProfileDataQualitative from "./ProfileQualitative"
import ProfileDataSources from "./ProfileDataSources"
import useAutoSave from "@/components/useAutoSave";


export default function Profile() {

    const urlParams = useParams();
    const API_BASE = import.meta.env.VITE_RELATIVITY_API
    const [loading, setLoading] = useState(true)
    const [profile, setProfile] = useState({
        // name: "profile-" + (new Date()).toISOString().split("T")[0],
        name: "",
        _id: "",
        created_at: "",
        qualitative: [],
        data_sources: []
    })

    useEffect(() => {
        const url = `${API_BASE}/read-profile?id=${urlParams.id}`;

        axios.get(url)
            .then((response) => {
                if (response.data) {
                    setProfile(response.data);
                    setLoading(false)
                }
            })
            .catch((error) => {
                console.error("API Error:", error);
            });
    }, []);

    const saveUrl = API_BASE + "/update-profile"
    const data = useMemo(() => ({
        id: urlParams.id,
        name: profile.name
    }), [profile.name,]);
    useAutoSave(data, saveUrl);


    return (

        <Flex direction={"column"} gap={6}>
            <Flex justify="space-between">

                <DataList.Root size="lg">
                    <DataList.Item>
                        <DataList.ItemLabel>Profile Name</DataList.ItemLabel>
                        <DataList.ItemValue>
                            <Input
                                variant={"flushed"}
                                value={profile.name}
                                onChange={(e) => { setProfile({ ...profile, name: e.target.value }) }}

                            />

                        </DataList.ItemValue>
                    </DataList.Item>
                </DataList.Root>

                <DataList.Root size="lg">
                    <DataList.Item>
                        <DataList.ItemLabel>Qualitative Parameters</DataList.ItemLabel>
                        <DataList.ItemValue>{profile.qualitative.length}</DataList.ItemValue>
                    </DataList.Item>
                </DataList.Root>

                <DataList.Root size="lg">
                    <DataList.Item>
                        <DataList.ItemLabel>Data Sources</DataList.ItemLabel>
                        <DataList.ItemValue>{profile.data_sources.length}</DataList.ItemValue>
                    </DataList.Item>
                </DataList.Root>

                <DownloadTrigger
                    data={JSON.stringify(profile, null, "  ")}
                    fileName={profile.name + "-" + (new Date()).toISOString().split("T")[0] + ".json"}
                    mimeType="application/json"
                    asChild
                >
                    <Button variant="outline">
                        <MdOutlineFileDownload />
                        Export profile
                        (<FormatByte value={JSON.stringify(profile, null, "  ").length} unitDisplay="narrow" />)

                    </Button>
                </DownloadTrigger>
            </Flex>


            <Flex direction={"column"} >

                <Tabs.Root defaultValue="qualitative">
                    <Tabs.List>
                        <Tabs.Trigger value="qualitative">
                            <LuUser />
                            Manage Qualitative Parameters
                        </Tabs.Trigger>
                        <Tabs.Trigger value="data-sources">
                            {/* <LuFolder /> */}
                            <LuSquareCheck />
                            Manage Data Sources
                        </Tabs.Trigger>
                    </Tabs.List>


                    <Tabs.Content value="qualitative">

                        {
                            loading ?
                                <Spinner />
                                :

                                <ProfileDataQualitative
                                    name={profile.name}
                                    data={profile.qualitative}
                                    id={urlParams.id}
                                />
                        }


                    </Tabs.Content>
                    <Tabs.Content value="data-sources">
                        {
                            loading ?
                                <Spinner />
                                :


                                <ProfileDataSources
                                    name={profile.name}
                                    data={profile.data_sources}
                                    id={urlParams.id}
                                />

                        }
                    </Tabs.Content>

                </Tabs.Root>


            </Flex>
        </Flex>



    )

}

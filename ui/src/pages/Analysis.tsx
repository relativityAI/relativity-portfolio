import SearchBar from "@/components/SearchBar";
import { Badge, Button, DataList, DownloadTrigger, Flex, FormatByte, Text, Separator, Input, Table, List, SimpleGrid } from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useState } from "react";
import { MdOutlineFileDownload } from "react-icons/md";
import { Link, useParams } from "react-router-dom";

export default function Analysis() {

    const urlParams = useParams()

    // const fetchExistingAnalysis = () =>{}

    const [availableProfiles, setAvailableProfiles] = useState([]);
    const [availableShares, setAvailableShares] = useState(["VBL", "KEI", "REL"]);
    const [selectedShare, setSelectedShare] = useState("VBL")
    const [selectedProfile, setSelectedProfile] = useState("test-pf")

    const [status, setStatus] = useState<"EMPTY" | "PENDING" | "COMPLETED">("EMPTY")

    const [config, setConfig] = useState({
        id: urlParams.id,
        exchange: "",
        share: "",
        profile: "",
        name: "",
    })


    const stats = [
        { label: "Management", value: "34.5", diff: -12, helpText: "Till date" },
        { label: "Growth", value: "56.5", diff: 12, helpText: "Last 30 days" },
        { label: "Tailwinds", value: "67.4", diff: 4.5, helpText: "Last 30 days" },
        { label: "Transcripts analysis", value: "76.8", diff: 4.5, helpText: "Last 30 days" },
    ]
    const items = [
        { id: 1, name: "Qualitative Score", category: ".5", price: 76.4 },
        { id: 2, name: "Data Sources Score", category: ".3", price: 68.4 },
        { id: 3, name: "Total Score", category: ".2", price: 57.3 },
    ]


    const API_BASE = import.meta.env.VITE_RELATIVITY_API

    const fetchAvailableProfiles = () => {

        axios.get(API_BASE + "/list-profiles")
            .then((response) => {
                // console.log(response);
                let profiles = []
                for (const prof of response.data) {
                    profiles.push(prof.name)
                }
                setAvailableProfiles(profiles)
            })
            .catch(function (error) {
                console.log(error);
            });
    }


    const runAnalysis = () => {

        axios.post(
            API_BASE + "/run-analysis",
            config
        )
            .then((response) => {
                console.log(response);

                if ("ok" in response.data && response.data.ok) {
                    setStatus("PENDING")
                }

            })
            .catch(function (error) {
                console.log(error);
            });
    }


    const fetchAnalysisStatus = () => {

        axios.get(
            API_BASE + "/analysis-status"
        )
            .then((response) => {
                console.log(response);

                if ("status" in response.data) {
                    setStatus(response.data.status)
                }

            })
            .catch(function (error) {
                console.log(error);
            });
    }

    useEffect(() => {

        fetchAvailableProfiles()
        // fetchAvailableShares()

    }, [])

    useEffect(() => {
        if (status == "PENDING") {
            const interval = setInterval(() => {
                console.log('This will be called every 2 seconds');
            }, 2000);
            return () => clearInterval(interval);
        }

    }, []);



    useEffect(() => {

        let saveName = `${config.exchange}-${config.share}-${config.profile}`
        console.log(saveName)
        setConfig({
            ...config,
            name: saveName
        })

    }, [config.exchange, config.share, config.profile])



    return (

        <Flex
            direction={"column"}
            gap={5}
        >
            <Flex justify={"space-between"} width={"1/2"}>

                <Badge colorPalette="green">Step 1: Select a company</Badge>
                <Badge colorPalette="green">Step 2: Select a pre built investor profile</Badge>
                <Badge colorPalette="green">Step 3: Hit Run.</Badge>
            </Flex>

            <Separator />

            <Flex
                gap={5}
                justify={"space-between"}
            >
                <Flex
                    width={"2/3"}
                    direction={"column"}
                    gap={3}
                >
                    <Text textStyle={"2xl"}>Analysis Config</Text>

                    <Separator />

                    <SimpleGrid
                        columns={2}
                        gap={2}
                    >

                        <SearchBar
                            url={`${API_BASE}/search-exchanges`}
                            label="Exchange 🌍"

                            mainKey="SYMBOL"
                            secondaryKey="NAME"

                            onChange={(field, value) => { setConfig({ ...config, [field]: value }) }}
                            field="exchange"

                        />
                        <SearchBar
                            url={`${API_BASE}/search-shares`}
                            label="Company 🏢"

                            mainKey="SYMBOL"
                            secondaryKey="NAME"

                            onChange={(field, value) => { setConfig({ ...config, [field]: value }) }}
                            field="share"
                        />

                        <SearchBar
                            url={`${API_BASE}/search-profiles`}
                            label="Investor Profile 👤"

                            mainKey="name"
                            secondaryKey="_id"

                            onChange={(field, value) => { setConfig({ ...config, [field]: value }) }}
                            field="profile"
                        />



                        <Flex direction={"column"} align={"start"} >

                            <Text>Save as</Text>
                            <Input
                                // value={selectedShare + "-" + (new Date().toISOString().split("T")[0])}
                                value={config.name}
                                placeholder="Flushed"
                                onChange={(e) => { setConfig({ ...config, name: e.target.value }) }}
                            // variant="flushed"

                            // width={"200px"}
                            />

                        </Flex>


                    </SimpleGrid>

                    <Button
                        disabled={
                            config.exchange == '' ||
                            config.share == '' ||
                            config.profile == '' ||
                            config.name == '--' ||
                            config.name == '' ||
                            status == "PENDING" ||
                            status == "COMPLETED"
                        }
                        variant="surface"
                        colorPalette={"blue"}
                        onClick={runAnalysis}
                    >
                        Run
                    </Button>
                </Flex>

                <Flex
                    width={"1/3"}

                    direction={"column"}
                    gap={3}
                >

                    <Text textStyle={"xl"}>Options</Text>
                    <Separator />

                    <Button disabled={status != "COMPLETED"} variant="surface" >+ Add to portfolio</Button>

                    <DownloadTrigger
                        data="Share analysis results"
                        fileName="sample.txt"
                        mimeType="text/plain"
                        asChild
                    >
                        <Button
                            disabled={status != "COMPLETED"}

                            variant="outline">
                            <MdOutlineFileDownload />
                            Download result</Button>
                    </DownloadTrigger>
                </Flex>

            </Flex>
            <Separator />


            {

                status != "COMPLETED" ?

                    <Flex
                        direction={"column"}
                        gap={3}
                    >

                        <Flex justify={"space-between"}>
                            <Text textStyle={"2xl"}>Results</Text>

                            <Text textStyle={"sm"} color={"grey"}>Analysis Duration: 2:12 min</Text>


                        </Flex>

                        <Flex gap={5} >

                            <Flex
                                direction={"column"}
                                gap={5}
                                width={"1/3"}
                            >
                                <Text textStyle={"xl"}>Qualitative</Text>

                                <DataList.Root orientation="horizontal">
                                    {stats.map((item) => (
                                        <DataList.Item key={item.label}>
                                            <DataList.ItemLabel>{item.label}</DataList.ItemLabel>
                                            <DataList.ItemValue>{item.value}</DataList.ItemValue>
                                        </DataList.Item>
                                    ))}

                                </DataList.Root>

                            </Flex>

                            <Flex
                                width={"1/3"}
                                direction={"column"}
                                gap={5}
                            >
                                <Text textStyle={"xl"}>Data Sources</Text>
                                <DataList.Root orientation="horizontal">
                                    {stats.map((item) => (
                                        <DataList.Item key={item.label}>
                                            <DataList.ItemLabel>{item.label}</DataList.ItemLabel>
                                            <DataList.ItemValue>{item.value}</DataList.ItemValue>
                                        </DataList.Item>
                                    ))}

                                </DataList.Root>

                            </Flex>

                            <Flex
                                width={"1/3"}
                                direction={"column"}
                                gap={5}
                            >
                                <Text textStyle={"xl"}>Total</Text>

                                <Table.Root size="sm">
                                    <Table.Header>
                                        <Table.Row>
                                            <Table.ColumnHeader>Product</Table.ColumnHeader>
                                            <Table.ColumnHeader>Category</Table.ColumnHeader>
                                            <Table.ColumnHeader textAlign="end">Price</Table.ColumnHeader>
                                        </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                        {items.map((item) => (
                                            <Table.Row key={item.id}>
                                                <Table.Cell>{item.name}</Table.Cell>
                                                <Table.Cell>{item.category}</Table.Cell>
                                                <Table.Cell textAlign="end">{item.price}</Table.Cell>
                                            </Table.Row>
                                        ))}
                                    </Table.Body>
                                </Table.Root>

                            </Flex>
                        </Flex>
                    </Flex>


                    :

                    <Flex justify={"center"} align={"center"} color={"grey"}>

                        <List.Root>
                            <List.Item>Results will appear here after the analysis process is complete. </List.Item>
                            <List.Item>When you hit run, the analysis starts in the background. </List.Item>
                            <List.Item>You latest and past analysis are available on the <Link to={"/analysis-list"}>Analysis List</Link> page. </List.Item>
                            <List.Item>Once the analysis status is "COMPLETED", the results will be visible. </List.Item>
                            <List.Item>After the analysis, you can add this share to a portfolio and/or download the result.</List.Item>

                        </List.Root>


                    </Flex>

            }

        </Flex>


    )

}

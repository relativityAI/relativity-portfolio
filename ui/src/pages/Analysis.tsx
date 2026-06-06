import SearchBar from "@/components/SearchBar";
import { Badge, Button, Flex, Text, Separator, Input, SimpleGrid, List, Spinner, DownloadTrigger } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { MdOutlineFileDownload } from "react-icons/md";
import { Link, useParams } from "react-router-dom";
import { AnalysisService, ProfileService, NEBULA_BASE } from "@/db";

export default function Analysis() {
    const { id } = useParams();

    const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
    const [correlationId, setCorrelationId] = useState<string>(id || "");


    const [status, setStatus] = useState<"EMPTY" | "PENDING" | "COMPLETED" | "ERROR">("EMPTY")
    const [loading, setLoading] = useState(false);

    const [config, setConfig] = useState({
        exchange: "",
        share: "",
        shareName: "",
        profile: "",
        name: "",
    })

    const handleConfigChange = (field: string, value: string, item?: any) => {
        setConfig(prev => ({
            ...prev,
            [field]: value || "",
            shareName: field === 'share' && item ? item.NAME : prev.shareName
        }))
    }

    const fetchAvailableProfiles = async () => {
        try {
            const data = await ProfileService.listProfiles();
            if (Array.isArray(data)) {
                setAvailableProfiles(data);
            } else {
                setAvailableProfiles([]);
            }
        } catch (error) {
            console.error("Error fetching available profiles:", error);
            setAvailableProfiles([]);
        }
    }

    const runAnalysis = async () => {
        try {
            const result = await AnalysisService.runAnalysis({
                share_name: config.shareName || config.share,
                symbol: config.share,
                profile_name: config.profile
            });

            if (result && (result.corr_id || result.analysis_id)) {
                setCorrelationId(result.corr_id || result.analysis_id);
                setStatus("PENDING");
            }
        } catch (error) {
            console.error("Run analysis error:", error);
            setStatus("ERROR");
        }
    }

    const fetchAnalysisData = async (analysisId: string) => {
        try {
            setLoading(true);
            const data = await AnalysisService.readAnalysis(analysisId);
            if (data) {
                // Update config based on loaded data if available
                setConfig(prev => ({
                    ...prev,
                    share: data.symbol || data.share || prev.share,
                    shareName: data.share_name || prev.shareName,
                    profile: data.profile_name || data.profile || prev.profile,
                    exchange: data.exchange || prev.exchange,
                }));

                if (data.status === "complete" || data.status === "error" || data.status === "COMPLETED" || data.status === "ERROR") {
                    const isComplete = data.status.toLowerCase() === "complete" || data.status.toLowerCase() === "completed";
                    setStatus(isComplete ? "COMPLETED" : "ERROR");
                } else {
                    setStatus("PENDING");
                }
            }
        } catch (error) {
            console.error("Error fetching analysis data:", error);
            setStatus("ERROR");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchAvailableProfiles()
        if (id) {
            fetchAnalysisData(id);
        }
    }, [id])

    useEffect(() => {
        if (status === "PENDING" && correlationId) {
            const interval = setInterval(async () => {
                try {
                    const data = await AnalysisService.readAnalysis(correlationId);
                    if (data) {
                        if (data.status === "complete" || data.status === "error" || data.status === "COMPLETED" || data.status === "ERROR") {
                            const isComplete = data.status.toLowerCase() === "complete" || data.status.toLowerCase() === "completed";
                            setStatus(isComplete ? "COMPLETED" : "ERROR");
                            clearInterval(interval);
                        }
                    }
                } catch (error: any) {
                    console.error("Check analysis status error:", error);
                    if (error.response && error.response.status === 404) {
                        console.log("Analysis not found, might need to wait or it failed.");
                    }
                }
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [status, correlationId]);

    useEffect(() => {
        let saveName = `${config.exchange}-${config.share}-${config.profile}`
        setConfig(prev => ({
            ...prev,
            name: saveName
        }))
    }, [config.exchange, config.share, config.profile])

    return (
        <Flex direction={"column"} gap={5}>
            <Flex justify={"space-between"} width={"1/2"}>
                <Badge colorPalette="green">Step 1: Select a company</Badge>
                <Badge colorPalette="green">Step 2: Select a pre built investor profile</Badge>
                <Badge colorPalette="green">Step 3: Hit Run.</Badge>
            </Flex>

            <Separator />

            <Flex gap={5} justify={"space-between"}>
                <Flex width={"2/3"} direction={"column"} gap={3}>
                    <Text textStyle={"2xl"}>Analysis Config</Text>
                    <Separator />
                    <SimpleGrid columns={2} gap={2}>
                        <SearchBar
                            url={`${NEBULA_BASE}/search-exchanges`}
                            label="Exchange 🌍"
                            mainKey="SYMBOL"
                            secondaryKey="NAME"
                            onChange={handleConfigChange}
                            field="exchange"
                        />
                        <SearchBar
                            url={`${NEBULA_BASE}/search-stocks`}
                            label="Company 🏢"
                            mainKey="SYMBOL"
                            secondaryKey="NAME"
                            onChange={handleConfigChange}
                            field="share"
                        />
                        <Flex direction={"column"} align={"start"}>
                            <Text mb={1} fontSize="sm" fontWeight="medium">Investor Profile 👤</Text>
                            <select
                                style={{ width: "100%", padding: "10px", border: "1px solid #444", borderRadius: "6px", backgroundColor: "transparent", color: "inherit" }}
                                value={config.profile}
                                onChange={(e) => {
                                    setConfig({ ...config, profile: e.target.value });
                                }}
                            >
                                <option value="" style={{ color: "black" }}>Select a profile</option>
                                {availableProfiles.map((p, idx) => (
                                    <option key={idx} value={p.name} style={{ color: "black" }}>{p.name}</option>
                                ))}
                            </select>
                        </Flex>
                        <Flex direction={"column"} align={"start"} >
                            <Text>Save as</Text>
                            <Input
                                value={config.name}
                                placeholder="Flushed"
                                onChange={(e) => { setConfig({ ...config, name: e.target.value }) }}
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
                            status == "PENDING"
                        }
                        variant="surface"
                        colorPalette={"blue"}
                        onClick={runAnalysis}
                    >
                        {status === "COMPLETED" ? "Run Again" : "Run"}
                    </Button>

                    {correlationId && (
                        <Link to={`/analysis-result/${correlationId}`}>
                            <Button width="full" colorPalette="green" variant="solid">
                                {status === "COMPLETED" ? "View Results ↗" : "View Progress ↗"}
                            </Button>
                        </Link>
                    )}
                </Flex>

                <Flex width={"1/3"} direction={"column"} gap={3}>
                    <Text textStyle={"xl"}>Options</Text>
                    <Separator />
                    <Button disabled={status != "COMPLETED"} variant="surface" >+ Add to portfolio</Button>
                    <DownloadTrigger
                        data="Share analysis results"
                        fileName="sample.txt"
                        mimeType="text/plain"
                        asChild
                    >
                        <Button disabled={status != "COMPLETED"} variant="outline">
                            <MdOutlineFileDownload />
                            Download result
                        </Button>
                    </DownloadTrigger>
                </Flex>
            </Flex>

            <Separator />

            {loading ? (
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Spinner size="xl" borderWidth="4px" />
                    <Text>Loading analysis data...</Text>
                </Flex>
            ) : status === "PENDING" ?
                <Flex justify="center" align="center" direction="column" gap={4} p={10}>
                    <Spinner size="xl" borderWidth="4px" />
                    <Text>Analysis in progress... This may take a few minutes.</Text>
                    {correlationId && (
                        <Link to={`/analysis-result/${correlationId}`}>
                            <Button variant="outline" colorPalette="green">View Progress in Real-time ↗</Button>
                        </Link>
                    )}
                </Flex>
                : status === "COMPLETED" && correlationId ?
                <Flex justify="center" align="center" direction="column" gap={6} p={20} bg="gray.900" borderRadius="xl">
                    <Text textStyle="2xl" fontWeight="bold">Analysis Completed Successfully!</Text>
                    <Link to={`/analysis-result/${correlationId}`}>
                        <Button size="xl" colorPalette="green" variant="solid">
                            Go to Analysis Result Page 🚀
                        </Button>
                    </Link>
                </Flex>
                :
                <Flex justify={"center"} align={"center"} color={"grey"}>
                    <List.Root>
                        <List.Item>Step 1: Select an exchange and a company you want to analyze.</List.Item>
                        <List.Item>Step 2: Select an investor profile that defines the scoring criteria.</List.Item>
                        <List.Item>Step 3: Click "Run" to start the analysis process.</List.Item>
                        <List.Item>Once started, you can track the progress on the dedicated result page.</List.Item>
                    </List.Root>
                </Flex>
            }
        </Flex>
    )
}

import { useEffect, useState } from "react";
import { Flex, Text } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError, MdAddCircleOutline, MdOutlinePeople, MdOutlineAssessment, MdOutlineSettings } from "react-icons/md";
import { LuWebhook, LuDatabase, LuSatellite } from "react-icons/lu";
import { ColorModeButton } from "@/components/ui/color-mode";

const VOYAGER_DOCS_URL = import.meta.env.VITE_VOYAGER_DOCS_URL || "https://voyager-1hpq.onrender.com";

export default function NavBar() {

    const [systemStatus, setSystemStatus] = useState({
        api: 0,
        db: 0,
        voyagerApi: 0,
    })

    const [endpoints, setEndpoints] = useState({
        api: "",
        db: "",
        voyagerApi: ""
    })

    useEffect(() => {
        const fetchData = async () => {
            const { data, endpoints } = await runHealthCheck();
            setSystemStatus(data)
            setEndpoints(endpoints)
        };

        fetchData();
    }, []);

    return (
        <Flex 
            paddingX={8} 
            paddingY={2} 
            borderBottom="1px solid" 
            borderColor="border" 
            justify={"space-between"} 
            align={"center"}
            bg="bg.subtle"
            height="56px"
        >
            <Flex align="center" gap={8}>
                <Text fontWeight={"bold"} fontSize="xl" letterSpacing="tight" color="fg">RELATIVITY</Text>
                
                <Flex gap={6} align="center">
                    <Link to={"/"}>
                        <Flex gap={1.5} align="center">
                            <MdAddCircleOutline size={16} color="var(--chakra-colors-fg-muted)" />
                            <Text fontSize="sm" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }}>New Analysis</Text>
                        </Flex>
                    </Link>
                    <Link to={"/agents"}>
                        <Flex gap={1.5} align="center">
                            <MdOutlinePeople size={16} color="var(--chakra-colors-fg-muted)" />
                            <Text fontSize="sm" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }}>Agents</Text>
                        </Flex>
                    </Link>
                    <Link to={"/analysis-list"}>
                        <Flex gap={1.5} align="center">
                            <MdOutlineAssessment size={16} color="var(--chakra-colors-fg-muted)" />
                            <Text fontSize="sm" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }}>Analysis</Text>
                        </Flex>
                    </Link>
                    <Link to={"/settings"}>
                        <Flex gap={1.5} align="center">
                            <MdOutlineSettings size={16} color="var(--chakra-colors-fg-muted)" />
                            <Text fontSize="sm" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }}>Settings</Text>
                        </Flex>
                    </Link>
                </Flex>
            </Flex>

            <Flex justify={"flex-end"} gap={6} align="center">
                <ColorModeButton />
                <Flex gap={4} align={"center"}>
                    <Flex gap={1} align={"center"}>
                        <LuWebhook size={12} color="var(--chakra-colors-fg-muted)" />
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.api ? "fg.subtle" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.api, "_blank")}
                        >
                            API
                        </Text>
                        {systemStatus.api ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>

                    <Flex gap={1} align={"center"}>
                        <LuDatabase size={12} color="var(--chakra-colors-fg-muted)" />
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.db ? "fg.subtle" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.db, "_blank")}
                        >
                            DB
                        </Text>
                        {systemStatus.db ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>

                    <Flex gap={1} align={"center"}>
                        <LuSatellite size={12} color="var(--chakra-colors-fg-muted)" />
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.voyagerApi ? "fg.subtle" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(VOYAGER_DOCS_URL + "/docs", "_blank")}
                        >
                            VOYAGER
                        </Text>
                        {systemStatus.voyagerApi ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>
                </Flex>
            </Flex>
        </Flex>
    )
}

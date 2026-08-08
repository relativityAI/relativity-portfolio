import { useEffect, useState } from "react";
import { Flex, Text, IconButton, Drawer, Separator } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError, MdAddCircleOutline, MdOutlinePeople, MdOutlineAssessment, MdOutlineSettings } from "react-icons/md";
import { LuWebhook, LuDatabase, LuSatellite, LuMenu, LuX } from "react-icons/lu";
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

    const [navOpen, setNavOpen] = useState(false)

    useEffect(() => {
        const fetchData = async () => {
            const { data, endpoints } = await runHealthCheck();
            setSystemStatus(data)
            setEndpoints(endpoints)
        };

        fetchData();
    }, []);

    const navLinks = [
        { to: "/", icon: MdAddCircleOutline, label: "New Analysis" },
        { to: "/agents", icon: MdOutlinePeople, label: "Agents" },
        { to: "/analysis-list", icon: MdOutlineAssessment, label: "Analysis" },
        { to: "/settings", icon: MdOutlineSettings, label: "Settings" },
    ]

    const statusRows = [
        { key: "api", label: "API", icon: LuWebhook, ok: !!systemStatus.api, open: () => window.open(endpoints.api, "_blank") },
        { key: "db", label: "DB", icon: LuDatabase, ok: !!systemStatus.db, open: () => window.open(endpoints.db, "_blank") },
        { key: "voyager", label: "VOYAGER", icon: LuSatellite, ok: !!systemStatus.voyagerApi, open: () => window.open(VOYAGER_DOCS_URL + "/docs", "_blank") },
    ]

    return (
        <Flex 
            paddingX={{ base: 4, md: 8 }} 
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
                
                <Flex gap={6} align="center" display={{ base: "none", md: "flex" }}>
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

            <Flex justify={"flex-end"} gap={{ base: 2, md: 6 }} align="center">
                <IconButton
                    aria-label="Open navigation menu"
                    variant="ghost"
                    display={{ base: "flex", md: "none" }}
                    minW="44px"
                    minH="44px"
                    p={0}
                    color="fg.muted"
                    _hover={{ color: "fg", bg: "bg.muted" }}
                    onClick={() => setNavOpen(true)}
                >
                    <LuMenu size={20} />
                </IconButton>
                <ColorModeButton />
                <Flex gap={4} align={"center"} display={{ base: "none", md: "flex" }}>
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

            <Drawer.Root
                open={navOpen}
                onOpenChange={(e) => setNavOpen(e.open)}
                placement="start"
                size={{ base: "full", sm: "xs" }}
            >
                <Drawer.Backdrop />
                <Drawer.Positioner>
                    <Drawer.Content bg="var(--surface-panel)">
                        <Drawer.Header
                            display="flex"
                            alignItems="center"
                            justifyContent="space-between"
                            borderBottom="1px solid var(--hairline)"
                            px={5}
                            py={4}
                        >
                            <Text fontWeight={"bold"} fontSize="xl" letterSpacing="tight" color="fg">RELATIVITY</Text>
                            <Drawer.CloseTrigger asChild>
                                <IconButton
                                    aria-label="Close navigation menu"
                                    variant="ghost"
                                    minW="44px"
                                    minH="44px"
                                    p={0}
                                    color="fg.muted"
                                    _hover={{ color: "fg", bg: "bg.muted" }}
                                >
                                    <LuX size={20} />
                                </IconButton>
                            </Drawer.CloseTrigger>
                        </Drawer.Header>
                        <Drawer.Body p={0}>
                            {navLinks.map((item) => (
                                <Link key={item.to} to={item.to} onClick={() => setNavOpen(false)}>
                                    <Flex
                                        gap={3}
                                        align="center"
                                        minH="48px"
                                        px={5}
                                        borderBottom="1px solid var(--hairline)"
                                    >
                                        <item.icon size={16} color="var(--chakra-colors-fg-muted)" />
                                        <Text fontSize="sm" fontWeight="medium" color="fg.muted" _hover={{ color: "fg" }}>
                                            {item.label}
                                        </Text>
                                    </Flex>
                                </Link>
                            ))}

                            <Flex
                                gap={2}
                                align="center"
                                minH="48px"
                                px={5}
                                color="var(--ink-tertiary)"
                            >
                                <Separator borderColor="var(--hairline)" />
                                <Text
                                    fontSize="10.5px"
                                    fontWeight={500}
                                    fontFamily="var(--font-mono)"
                                    letterSpacing="0.06em"
                                    textTransform="uppercase"
                                    whiteSpace="nowrap"
                                >
                                    System
                                </Text>
                                <Separator borderColor="var(--hairline)" />
                            </Flex>

                            {statusRows.map((row) => (
                                <Flex
                                    key={row.key}
                                    gap={2.5}
                                    align="center"
                                    minH="48px"
                                    px={5}
                                    borderBottom="1px solid var(--hairline)"
                                    cursor="pointer"
                                    onClick={row.open}
                                >
                                    <row.icon size={14} color="var(--chakra-colors-fg-muted)" />
                                    <Text
                                        textStyle="xs"
                                        fontWeight="bold"
                                        fontFamily="var(--font-mono)"
                                        letterSpacing="0.06em"
                                        color={row.ok ? "var(--ink-secondary)" : "red.500"}
                                    >
                                        {row.label}
                                    </Text>
                                    {row.ok ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                </Flex>
                            ))}
                        </Drawer.Body>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Drawer.Root>
        </Flex>
    )
}

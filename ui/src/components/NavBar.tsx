import { useEffect, useState } from "react";
import { Flex, Text, IconButton, Drawer, Separator, Menu } from "@chakra-ui/react"
import { Link, useLocation } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError, MdAddCircleOutline, MdOutlinePeople, MdOutlineAssessment, MdOutlineSettings, MdOutlineLogout } from "react-icons/md";
import { LuWebhook, LuDatabase, LuSatellite, LuMenu, LuX } from "react-icons/lu";
import { ColorModeButton } from "@/components/ui/color-mode";
import { useAuth } from "@/auth/useAuth";

const VOYAGER_DOCS_URL = import.meta.env.VITE_VOYAGER_DOCS_URL || "https://voyager-1hpq.onrender.com";
const HEALTH_CHECK_INTERVAL_MS = 15000;

export default function NavBar() {

    const location = useLocation();
    const { user, signOut } = useAuth();

    const email = user?.email ?? "";
    const displayName =
        (user?.user_metadata?.name as string | undefined) ??
        (user?.user_metadata?.full_name as string | undefined) ??
        email.split("@")[0] ??
        (user?.id?.slice(0, 8) ?? "User");
    const initials = (displayName || email || "?").slice(0, 2).toUpperCase();

    const [systemStatus, setSystemStatus] = useState({
        api: 0,
        db: 0,
        voyagerApi: 0,
        voyagerKeyed: false,
    })

    const [endpoints, setEndpoints] = useState({
        api: "",
        db: "",
        voyagerApi: ""
    })

    const [navOpen, setNavOpen] = useState(false)

    useEffect(() => {
        let cancelled = false;
        const fetchData = async () => {
            const { data, endpoints } = await runHealthCheck();
            if (!cancelled) {
                setSystemStatus(data)
                setEndpoints(endpoints)
            }
        };

        const refreshOnVisible = () => fetchData();

        fetchData();
        const interval = setInterval(fetchData, HEALTH_CHECK_INTERVAL_MS);
        window.addEventListener("focus", refreshOnVisible);
        document.addEventListener("visibilitychange", refreshOnVisible);
        return () => {
            cancelled = true;
            clearInterval(interval);
            window.removeEventListener("focus", refreshOnVisible);
            document.removeEventListener("visibilitychange", refreshOnVisible);
        };
    }, [location.pathname]);

    const navLinks = [
        { to: "/", icon: MdAddCircleOutline, label: "New Analysis" },
        { to: "/agents", icon: MdOutlinePeople, label: "Agents" },
        { to: "/analysis-list", icon: MdOutlineAssessment, label: "Analysis" },
        { to: "/settings", icon: MdOutlineSettings, label: "Settings" },
    ]

    const apiOk = !!systemStatus.api;
    const dbOk = !!systemStatus.db;
    const voyagerOk = !!systemStatus.voyagerApi;
    const voyagerKeyed = !!systemStatus.voyagerKeyed;

    const voyagerState = !voyagerOk
        ? { color: "red", labelColor: "red.500", icon: <MdError size={12} color="red" />, title: "Voyager unreachable" }
        : voyagerKeyed
            ? { color: "green", labelColor: "fg.subtle", icon: <MdCheckCircle size={12} color="green" />, title: "Voyager healthy · API key added" }
            : { color: "blue", labelColor: "blue.500", icon: <MdCheckCircle size={12} color="blue" />, title: "Voyager healthy · no API key added" };

    const statusRows = [
        { key: "api", label: "API", icon: LuWebhook, ok: apiOk, open: () => window.open(endpoints.api, "_blank") },
        { key: "db", label: "DB", icon: LuDatabase, ok: dbOk, open: () => window.open(endpoints.db, "_blank") },
        { key: "voyager", label: "VOYAGER", icon: LuSatellite, ok: voyagerOk, stateIcon: voyagerState.icon, stateTitle: voyagerState.title, stateColor: voyagerState.labelColor, open: () => window.open(VOYAGER_DOCS_URL + "/docs", "_blank") },
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
                <Menu.Root>
                    <Menu.Trigger asChild>
                        <Flex
                            align="center"
                            gap={2}
                            px={2}
                            py={1}
                            borderRadius="full"
                            bg="blue.muted"
                            cursor="pointer"
                            _hover={{ bg: "blue.subtle" }}
                            title={email || "Account"}
                        >
                            <Flex
                                align="center"
                                justify="center"
                                minW="24px"
                                minH="24px"
                                borderRadius="full"
                                bg="blue.solid"
                                color="white"
                                fontSize="xs"
                                fontWeight="bold"
                            >
                                {initials}
                            </Flex>
                            <Text
                                fontSize="sm"
                                fontWeight="semibold"
                                color="blue.300"
                                display={{ base: "none", md: "block" }}
                            >
                                {displayName}
                            </Text>
                        </Flex>
                    </Menu.Trigger>
                    <Menu.Positioner>
                        <Menu.Content minWidth="260px">
                            <Flex direction="column" gap={0} px={3} py={2.5} w="full" minW="0">
                                <Text textStyle="xs" color="fg.muted">Signed in as</Text>
                                <Text
                                    fontSize="sm"
                                    color="fg"
                                    w="full"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    whiteSpace="nowrap"
                                >
                                    {email}
                                </Text>
                            </Flex>
                            <Menu.Separator />
                            <Menu.Item value="signout" onClick={() => signOut()}>
                                <MdOutlineLogout size={15} />
                                Sign out
                            </Menu.Item>
                        </Menu.Content>
                    </Menu.Positioner>
                </Menu.Root>
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
                            color={voyagerState.labelColor} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(VOYAGER_DOCS_URL + "/docs", "_blank")}
                            title={voyagerState.title}
                        >
                            VOYAGER
                        </Text>
                        {voyagerState.icon}
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
                                    title={row.stateTitle}
                                >
                                    <row.icon size={14} color="var(--chakra-colors-fg-muted)" />
                                    <Text
                                        textStyle="xs"
                                        fontWeight="bold"
                                        fontFamily="var(--font-mono)"
                                        letterSpacing="0.06em"
                                        color={row.stateColor ?? (row.ok ? "var(--ink-secondary)" : "red.500")}
                                    >
                                        {row.label}
                                    </Text>
                                    {row.stateIcon ?? (row.ok ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />)}
                                </Flex>
                            ))}
                        </Drawer.Body>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Drawer.Root>
        </Flex>
    )
}

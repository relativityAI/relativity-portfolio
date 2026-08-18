import { useEffect, useState } from "react";
import { Flex, Text, IconButton, Drawer, Separator, Menu, Popover } from "@chakra-ui/react"
import { Link, useLocation } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError, MdAddCircleOutline, MdOutlinePeople, MdOutlineAssessment, MdOutlineSettings, MdOutlineLogout } from "react-icons/md";
import { LuWebhook, LuDatabase, LuSatellite, LuMenu, LuX } from "react-icons/lu";
import { ColorModeButton } from "@/components/ui/color-mode";
import { useAuth } from "@/auth/useAuth";

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

            <Flex justify={"flex-end"} gap={{ base: 2, md: 4 }} align="center">
                <IconButton
                    aria-label="Open navigation menu"
                    variant="ghost"
                    size="sm"
                    display={{ base: "flex", md: "none" }}
                    color="fg.muted"
                    _hover={{ color: "fg", bg: "bg.muted" }}
                    onClick={() => setNavOpen(true)}
                >
                    <LuMenu size={16} />
                </IconButton>
                <ColorModeButton />
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <IconButton
                            aria-label="System status"
                            variant="ghost"
                            size="sm"
                            color={apiOk && dbOk ? "fg.muted" : "red.500"}
                            _hover={{ color: "fg" }}
                        >
                            <LuSatellite size={16} />
                        </IconButton>
                    </Popover.Trigger>
                    <Popover.Positioner>
                        <Popover.Content width="220px">
                            <Popover.Arrow>
                                <Popover.ArrowTip />
                            </Popover.Arrow>
                            <Popover.Header fontWeight="semibold" fontSize="xs">
                                System Status
                            </Popover.Header>
                            <Popover.Body>
                                <Flex direction="column" gap={2}>
                                    <Flex justify="space-between" align="center">
                                        <Flex gap={1.5} align="center">
                                            <LuWebhook size={12} color="var(--chakra-colors-fg-muted)" />
                                            <Text fontSize="xs" fontWeight="500">API</Text>
                                        </Flex>
                                        {apiOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                    </Flex>
                                    <Flex justify="space-between" align="center">
                                        <Flex gap={1.5} align="center">
                                            <LuDatabase size={12} color="var(--chakra-colors-fg-muted)" />
                                            <Text fontSize="xs" fontWeight="500">DB</Text>
                                        </Flex>
                                        {dbOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                    </Flex>
                                    <Flex justify="space-between" align="center">
                                        <Flex gap={1.5} align="center">
                                            <LuSatellite size={12} color="var(--chakra-colors-fg-muted)" />
                                            <Text fontSize="xs" fontWeight="500">
                                                Data Provider{" "}
                                                <Text as="span" color="fg.muted" fontWeight="400">(Voyager)</Text>
                                            </Text>
                                        </Flex>
                                        {voyagerOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                    </Flex>
                                </Flex>
                            </Popover.Body>
                        </Popover.Content>
                    </Popover.Positioner>
                </Popover.Root>
                <Menu.Root>
                    <Menu.Trigger asChild>
                        <Flex
                            align="center"
                            justify="center"
                            minW="28px"
                            minH="28px"
                            borderRadius="full"
                            bg="blue.solid"
                            cursor="pointer"
                            _hover={{ opacity: 0.85 }}
                            title={email || "Account"}
                        >
                            <Text
                                fontSize="xs"
                                fontWeight="bold"
                                color="white"
                            >
                                {initials}
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

                            <Flex gap={2.5} align="center" minH="48px" px={5} borderBottom="1px solid var(--hairline)">
                                <LuWebhook size={14} color="var(--chakra-colors-fg-muted)" />
                                <Text textStyle="xs" fontWeight="bold" fontFamily="var(--font-mono)" letterSpacing="0.06em" color="var(--ink-secondary)">API</Text>
                                {apiOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                            </Flex>
                            <Flex gap={2.5} align="center" minH="48px" px={5} borderBottom="1px solid var(--hairline)">
                                <LuDatabase size={14} color="var(--chakra-colors-fg-muted)" />
                                <Text textStyle="xs" fontWeight="bold" fontFamily="var(--font-mono)" letterSpacing="0.06em" color="var(--ink-secondary)">DB</Text>
                                {dbOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                            </Flex>
                            <Flex gap={2.5} align="center" minH="48px" px={5} borderBottom="1px solid var(--hairline)">
                                <LuSatellite size={14} color="var(--chakra-colors-fg-muted)" />
                                <Text textStyle="xs" fontWeight="bold" fontFamily="var(--font-mono)" letterSpacing="0.06em" color="var(--ink-secondary)">
                                    Data Provider <Text as="span" color="var(--ink-tertiary)" fontWeight="400">(Voyager)</Text>
                                </Text>
                                {voyagerOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                            </Flex>
                        </Drawer.Body>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Drawer.Root>
        </Flex>
    )
}

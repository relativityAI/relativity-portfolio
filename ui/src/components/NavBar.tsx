import { useEffect, useState } from "react";
import { Flex, Text, IconButton, Drawer, Separator, Menu, Badge, Box } from "@chakra-ui/react"
import { Link, useLocation } from "react-router-dom";
import { runHealthCheck, hasRequiredKeys } from "../utils"
import { SettingsService, AnalysisService, AgentService } from "@/db";
import { MdCheckCircle, MdError, MdAddCircleOutline, MdOutlinePeople, MdOutlineAssessment, MdOutlineSettings, MdOutlineLogout, MdWarning } from "react-icons/md";
import { LuWebhook, LuDatabase, LuSatellite, LuMenu, LuX, LuBookOpen } from "react-icons/lu";
import { ColorModeButton } from "@/components/ui/color-mode";
import { useAuth } from "@/auth/useAuth";
import { motion } from "motion/react";
import Logo from "@/components/Logo";

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

    const [missingKeys, setMissingKeys] = useState(false)

    const [agentCount, setAgentCount] = useState<number | null>(null)
    const [analysisCount, setAnalysisCount] = useState<number | null>(null)

    useEffect(() => {
        let cancelled = false;

        AnalysisService.listAnalyses()
            .then((data) => {
                if (cancelled || !Array.isArray(data)) return;
                setAnalysisCount(data.length);
            })
            .catch(() => {});

        AgentService.listAgents()
            .then((data) => {
                if (!cancelled && Array.isArray(data)) setAgentCount(data.length);
            })
            .catch(() => {});

        SettingsService.getSettings()
            .then((settings) => {
                if (cancelled) return;
                const { hasLlm, hasTavily } = hasRequiredKeys(settings);
                setMissingKeys(!hasLlm || !hasTavily);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [location.pathname]);

    // Health probes are NOT per-route work: they used to refire on every
    // navigation, stacking multi-second Voyager cold-start requests. Run the
    // loop once per mount with an in-flight guard and debounced refocus.
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const fetchData = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const { data, endpoints } = await runHealthCheck();
                if (!cancelled) {
                    setSystemStatus(data);
                    setEndpoints(endpoints);
                }
            } finally {
                inFlight = false;
            }
        };

        // Tab switches fire focus AND visibilitychange — debounce to one probe.
        const refreshOnVisible = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => fetchData(), 500);
        };

        fetchData();
        const interval = setInterval(fetchData, HEALTH_CHECK_INTERVAL_MS);
        window.addEventListener("focus", refreshOnVisible);
        document.addEventListener("visibilitychange", refreshOnVisible);

        return () => {
            cancelled = true;
            clearInterval(interval);
            if (timer) clearTimeout(timer);
            window.removeEventListener("focus", refreshOnVisible);
            document.removeEventListener("visibilitychange", refreshOnVisible);
        };
    }, []);

    // Single source for both desktop links and the mobile drawer.
    const navLinks = [
        { to: "/", icon: MdAddCircleOutline, label: "New Analysis" },
        { to: "/agents", icon: MdOutlinePeople, label: "Agents" },
        { to: "/analysis-list", icon: MdOutlineAssessment, label: "Analysis" },
        { to: "/guide", icon: LuBookOpen, label: "Guide" },
        { to: "/settings", icon: MdOutlineSettings, label: "Settings" },
    ]

    const navCount = (to: string) => {
        if (to === "/agents") return agentCount;
        if (to === "/analysis-list") return analysisCount;
        return null;
    }

    const isNavActive = (to: string) =>
        location.pathname === to || (to !== "/" && location.pathname.startsWith(to));

    const apiOk = !!systemStatus.api;
    const dbOk = !!systemStatus.db;
    const voyagerOk = !!systemStatus.voyagerApi;
    // The account menu's status dot must reflect all three signals.
    const allOk = apiOk && dbOk && voyagerOk;

    const StatusRow = ({ icon: Icon, label, ok }: { icon: typeof LuWebhook; label: string; ok: boolean }) => (
        <Flex justify="space-between" align="center" minH="24px">
            <Flex gap={1.5} align="center">
                <Icon size={12} color="var(--chakra-colors-fg-muted)" />
                <Text fontSize="xs" fontWeight="500">{label}</Text>
            </Flex>
            {ok ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
        </Flex>
    );

    return (
        <Flex
            paddingX={{ base: 3, md: 8 }}
            paddingY={0.5}
            borderBottom="1px solid"
            borderColor="border"
            justify={"space-between"}
            align={"center"}
            bg="bg.subtle"
            height="44px"
        >
            <Flex align="center" gap={{ base: 5, md: 4, lg: 8 }} minW={0} flexShrink={1}>
                <Flex align="center" gap={2} minW={0}>
                    <Logo preset="nav" showWordmark={false} />
                </Flex>

                <Flex gap={{ md: 3, lg: 6 }} align="center" display={{ base: "none", md: "flex" }} minW={0}>
                    {navLinks.map((item) => {
                        const active = isNavActive(item.to);
                        const count = navCount(item.to);
                        return (
                            <Link key={item.to} to={item.to}>
                                <Flex gap={1.5} align="center" position="relative" py={1}>
                                    <item.icon size={16} color={active ? "var(--chakra-colors-fg)" : "var(--chakra-colors-fg-muted)"} />
                                    <Text fontSize={{ md: "xs", lg: "sm" }} whiteSpace="nowrap" flexShrink={0} fontWeight={active ? "semibold" : "medium"} color={active ? "fg" : "fg.muted"} _hover={{ color: "fg" }}>{item.label}</Text>
                                    {count !== null && count > 0 && (
                                        <Badge size="xs" variant="subtle" colorPalette="gray" borderRadius="full">{count}</Badge>
                                    )}
                                    {item.to === "/settings" && missingKeys && (
                                        <MdWarning size={14} color="var(--signal-warning)" aria-label="API keys missing" />
                                    )}
                                    {active && <Box as={motion.div} layoutId="nav-underline" position="absolute" bottom="-6px" left={0} right={0} h="2px" bg="var(--accent-primary)" borderRadius="1px" />}
                                </Flex>
                            </Link>
                        );
                    })}
                </Flex>
            </Flex>

            <Flex justify={"flex-end"} gap={{ base: 1.5, md: 2 }} align="center" flexShrink={0}>
                <IconButton
                    aria-label="Open navigation menu"
                    variant="ghost"
                    size="xs"
                    display={{ base: "flex", md: "none" }}
                    color="fg.muted"
                    _hover={{ color: "fg", bg: "bg.muted" }}
                    onClick={() => setNavOpen(true)}
                >
                    <LuMenu size={15} />
                </IconButton>
                <ColorModeButton size="xs" variant="ghost" />
                <Menu.Root>
                    <Menu.Trigger asChild>
                        <Flex
                            align="center"
                            justify="center"
                            minW="26px"
                            minH="26px"
                            borderRadius="full"
                            bg={allOk ? "blue.solid" : "red.solid"}
                            cursor="pointer"
                            _hover={{ opacity: 0.85 }}
                            title={email || "Account"}
                            position="relative"
                        >
                            <Text
                                fontSize="xs"
                                fontWeight="bold"
                                color="white"
                            >
                                {initials}
                            </Text>
                            {!allOk && (
                                <Box
                                    position="absolute"
                                    top="-1px"
                                    right="-1px"
                                    w="9px"
                                    h="9px"
                                    borderRadius="full"
                                    bg="red.solid"
                                    border="2px solid"
                                    borderColor="bg.subtle"
                                    aria-label="System issue detected"
                                />
                            )}
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
                            <Menu.ItemGroup id="status" label="System status">
                                <Menu.Item value="status-api" closeOnSelect={false} cursor="default">
                                    <LuWebhook size={15} color="var(--chakra-colors-fg-muted)" />
                                    API
                                    <Box flex={1} />
                                    {apiOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                </Menu.Item>
                                <Menu.Item value="status-db" closeOnSelect={false} cursor="default">
                                    <LuDatabase size={15} color="var(--chakra-colors-fg-muted)" />
                                    Database
                                    <Box flex={1} />
                                    {dbOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                </Menu.Item>
                                <Menu.Item value="status-voyager" closeOnSelect={false} cursor="default">
                                    <LuSatellite size={15} color="var(--chakra-colors-fg-muted)" />
                                    Data provider (Voyager)
                                    <Box flex={1} />
                                    {voyagerOk ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                                </Menu.Item>
                            </Menu.ItemGroup>
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
                            py={3}
                        >
                            <Flex align="center" gap={2} minW={0}>
                                <Logo preset="nav" />
                            </Flex>
                            <Drawer.CloseTrigger asChild>
                                <IconButton
                                    aria-label="Close navigation menu"
                                    variant="subtle"
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
                            {navLinks.map((item) => {
                                const active = isNavActive(item.to);
                                const count = navCount(item.to);
                                return (
                                    <Link key={item.to} to={item.to} onClick={() => setNavOpen(false)}>
                                        <Flex
                                            gap={3}
                                            align="center"
                                            minH="48px"
                                            px={5}
                                            borderBottom="1px solid var(--hairline)"
                                            bg={active ? "bg.subtle" : "transparent"}
                                            borderLeft="3px solid"
                                            borderLeftColor={active ? "var(--accent-primary)" : "transparent"}
                                        >
                                            <item.icon size={16} color={active ? "var(--chakra-colors-fg)" : "var(--chakra-colors-fg-muted)"} />
                                            <Text fontSize="sm" fontWeight={active ? "semibold" : "medium"} color={active ? "fg" : "fg.muted"}>
                                                {item.label}
                                            </Text>
                                            {count !== null && count > 0 && (
                                                <Badge size="xs" variant="subtle" colorPalette="gray" borderRadius="full">{count}</Badge>
                                            )}
                                            {item.to === "/settings" && missingKeys && (
                                                <MdWarning size={14} color="var(--signal-warning)" aria-label="API keys missing" />
                                            )}
                                        </Flex>
                                    </Link>
                                );
                            })}

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

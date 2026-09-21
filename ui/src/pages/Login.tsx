import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Flex, Text, Box } from "@chakra-ui/react";
import { motion } from "motion/react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/useAuth";
import { dur, ease } from "@/lib/motion";
import logoMark from "@/assets/logo-mark.png";

interface GoogleGsiId {
  initialize(settings: { client_id: string; callback: (res: { credential?: string }) => void }): void;
  renderButton(
    element: HTMLElement,
    options: { type?: "standard"; theme?: "filled_black" | "outline"; shape?: "rectangular" | "pill"; width?: number },
  ): void;
}

function gsiId(): GoogleGsiId | undefined {
  return (window as unknown as { google?: { accounts?: { id?: GoogleGsiId } } }).google?.accounts?.id;
}

const STUDY = [
  {
    side: "A",
    label: "Growth thesis",
    color: "var(--signal-positive)",
    score: "87",
    verdict: "Fits",
    thesis: "Revenue is compounding — margin expansion is the next act.",
  },
  {
    side: "B",
    label: "Value thesis",
    color: "var(--signal-negative)",
    score: "22",
    verdict: "Doesn't fit",
    thesis: "Thin margins at a rich multiple — the cut is the next act.",
  },
];

export default function Login() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const gsiRef = useRef<HTMLDivElement>(null);
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

    useEffect(() => {
        if (user) {
            navigate("/", { replace: true });
            return;
        }
        if (!clientId || !gsiRef.current) return;
        const gsi = gsiId();
        if (!gsi) return;
        gsi.initialize({
            client_id: clientId,
            callback: async (res) => {
                if (!res.credential) return;
                await supabase.auth.signInWithIdToken({ provider: "google", token: res.credential });
            },
        });
        gsiRef.current.innerHTML = "";
        const width = Math.min(210, gsiRef.current.clientWidth - 1 || 210);
        gsi.renderButton(gsiRef.current, { type: "standard", theme: "outline", shape: "pill", width });
    }, [user, navigate, clientId]);

    if (user) return null;

    const reveal = (delay: number) => ({
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0, transition: { duration: dur.slow, ease, delay } },
    });

    const monoLabel = {
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
    } as const;

    return (
        <Flex minH="calc(100vh - 44px)" align="center" justify="center" p={6} position="relative" overflow="hidden">
            <Helmet>
                <title>Sign in | Relativity AI</title>
                <meta name="description" content="Build an investor agent that scores stocks against your thesis. Sign in with Google." />
            </Helmet>
            <Box position="absolute" inset={0} pointerEvents="none" opacity={0.12} css={{ background: "radial-gradient(560px 320px at 50% 12%, var(--accent-primary) 0%, transparent 70%)" }} />

            <Flex direction="column" align="center" w="100%" maxW="560px" gap={5}>
                {/* Wordmark */}
                <motion.div {...reveal(0)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={logoMark} alt="" style={{ height: "22px", width: "auto", borderRadius: 8 }} />
                    <Text fontFamily="var(--font-mono)" fontWeight="bold" fontSize="xs" letterSpacing="0.2em" color="var(--ink-primary)" textTransform="uppercase">
                        Relativity
                    </Text>
                </motion.div>

                {/* Signature — one equity, two lenses */}
                <motion.div {...reveal(0.08)} style={{ width: "100%" }}>
                    <Box borderWidth="1px" borderColor="var(--hairline)" borderRadius="lg" bg="var(--surface-panel)" overflow="hidden">
                        <Flex align="center" justify="space-between" px={4} py={2} borderBottom="1px solid var(--hairline)">
                            <Text {...monoLabel} color="var(--ink-tertiary)" fontSize="10.5px">One equity · two lenses</Text>
                            <Text {...monoLabel} color="var(--ink-tertiary)" fontSize="10.5px">Illustrative</Text>
                        </Flex>
                        <Flex direction={{ base: "column", md: "row" }} align="stretch" position="relative">
                            {STUDY.map((s, i) => (
                                <Flex
                                    key={s.side}
                                    flex={1}
                                    direction="column"
                                    gap={2.5}
                                    px={4}
                                    py={4}
                                    borderTop={i > 0 ? { base: "1px solid var(--hairline)", md: "none" } : undefined}
                                    borderRight={i === 0 ? { base: "none", md: "1px solid var(--hairline)" } : undefined}
                                >
                                    <Flex align="baseline" justify="space-between">
                                        <Text {...monoLabel} color={s.color}>
                                            {s.side} · {s.label}
                                        </Text>
                                    </Flex>
                                    <Text fontSize="13px" color="var(--ink-secondary)" lineHeight="short">
                                        {s.thesis}
                                    </Text>
                                    <Flex align="flex-end" gap={2.5} mt="auto" pt={1}>
                                        <Text as="span" fontFamily="var(--font-mono)" fontWeight={600} fontSize="clamp(2rem, 5vw, 2.6rem)" lineHeight={1} color={s.color}>
                                            {s.score}
                                        </Text>
                                        <Text
                                            {...monoLabel}
                                            fontSize="10px"
                                            mb={1}
                                            px={2}
                                            py={0.5}
                                            borderRadius="full"
                                            borderWidth="1px"
                                            style={{ borderColor: s.color, color: s.color }}
                                        >
                                            {s.verdict}
                                        </Text>
                                    </Flex>
                                </Flex>
                            ))}
                            {/* VS — sits on the seam (desktop only) */}
                            <Flex
                                display={{ base: "none", md: "flex" }}
                                position="absolute"
                                left="50%"
                                top="50%"
                                transform="translate(-50%, -50%)"
                                align="center"
                                justify="center"
                                w={7}
                                h={7}
                                borderRadius="full"
                                borderWidth="1px"
                                borderColor="var(--hairline)"
                                bg="var(--surface-panel)"
                                zIndex={1}
                            >
                                <Text {...monoLabel} fontSize="9px" color="var(--ink-tertiary)">vs</Text>
                            </Flex>
                        </Flex>
                    </Box>
                </motion.div>

                {/* Logline */}
                <motion.div {...reveal(0.16)} style={{ margin: 0, textAlign: "center" }}>
                    <Text fontSize="sm" color="var(--ink-secondary)" maxW="380px" mx="auto">
                        Same filing. Opposite reads. Both defensible.
                    </Text>
                </motion.div>

                {/* Sign in */}
                <motion.div {...reveal(0.22)}>
                    <Text {...monoLabel} fontSize="10.5px" color="var(--ink-tertiary)" textAlign="center" mb={2.5}>
                        Sign in to build yours
                    </Text>
                    {clientId ? (
                        <Box ref={gsiRef} w="full" css={{ "> div": { mx: "auto" } }} />
                    ) : (
                        <Text fontSize="sm" color="var(--signal-negative)" textAlign="center">
                            Missing VITE_GOOGLE_CLIENT_ID.
                        </Text>
                    )}
                </motion.div>

                <motion.div {...reveal(0.28)} style={{ margin: 0, textAlign: "center" }}>
                    <Text {...monoLabel} fontSize="10px" color="var(--ink-tertiary)" lineHeight="1.6">
                        *Illustrative sample — not investment advice
                    </Text>
                </motion.div>
            </Flex>
        </Flex>
    );
}
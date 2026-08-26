import { Flex, Text, Box, Button, VStack } from "@chakra-ui/react";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "@/auth/useAuth";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Helmet } from "react-helmet-async";
import { dur, ease } from "@/lib/motion";

export default function Login() {
    const { signInWithGoogle } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleGoogle = async () => {
        setError(null);
        setSubmitting(true);
        try {
            const { error } = await signInWithGoogle();
            if (error) setError(error);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Flex minH="calc(100vh - 56px)" align="center" justify="center" p={6} position="relative" overflow="hidden">
            <Helmet>
                <title>Sign in | Relativity AI</title>
                <meta name="description" content="Sign in to your Relativity AI workspace." />
            </Helmet>
            <Box position="absolute" inset={0} pointerEvents="none" opacity={0.35} css={{ background: "radial-gradient(600px 300px at 50% 0%, var(--accent-primary) 0%, transparent 70%)" }} />
            <Box
                as={motion.div}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: dur.slow, ease }}
                w="100%"
                maxW="400px"
                p={8}
                borderWidth="1px"
                borderColor="border"
                borderRadius="xl"
                bg="bg.subtle"
                position="relative"
            >
                <VStack gap={6} align="stretch">
                    <VStack gap={1} align="center">
                        <Text fontWeight="bold" fontSize="2xl" letterSpacing="tight" color="fg">
                            RELATIVITY
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                            Sign in to your workspace
                        </Text>
                    </VStack>

                    <AnimatePresence>
                        {error && (
                            <Box as={motion.div} initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -6, height: 0 }} transition={{ duration: dur.base, ease }} overflow="hidden">
                                <Text fontSize="sm" color="red.400" textAlign="center">
                                    {error}
                                </Text>
                            </Box>
                        )}
                    </AnimatePresence>

                    <Button
                        as={motion.button}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        variant="outline"
                        w="full"
                        onClick={handleGoogle}
                        loading={submitting}
                    >
                        <FcGoogle size={18} />
                        <Text ml={2}>Continue with Google</Text>
                    </Button>
                </VStack>
            </Box>
        </Flex>
    );
}

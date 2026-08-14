import { useState, type FormEvent } from "react";
import {
    Flex, Text, Box, Button, Input, Field, VStack, HStack, Separator,
} from "@chakra-ui/react";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "@/auth/useAuth";

type Mode = "signin" | "signup";

export default function Login() {
    const { signInWithEmail, signUp, signInWithGoogle } = useAuth();

    const [mode, setMode] = useState<Mode>("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
        if (!email.trim() || !password) {
            setError("Email and password are required.");
            return;
        }
        setSubmitting(true);
        try {
            const result =
                mode === "signin"
                    ? await signInWithEmail(email.trim(), password)
                    : await signUp(email.trim(), password);
            if (result.error) {
                setError(result.error);
            } else if (mode === "signup") {
                setInfo(
                    "Account created. Check your inbox for a confirmation email before signing in.",
                );
                setMode("signin");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogle = async () => {
        setError(null);
        const { error } = await signInWithGoogle();
        if (error) setError(error);
    };

    return (
        <Flex minH="calc(100vh - 56px)" align="center" justify="center" p={6}>
            <Box
                w="100%"
                maxW="400px"
                p={8}
                borderWidth="1px"
                borderColor="border"
                borderRadius="xl"
                bg="bg.subtle"
            >
                <VStack gap={6} align="stretch">
                    <VStack gap={1} align="center">
                        <Text fontWeight="bold" fontSize="2xl" letterSpacing="tight" color="fg">
                            RELATIVITY
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                            {mode === "signin"
                                ? "Sign in to your workspace"
                                : "Create a new workspace"}
                        </Text>
                    </VStack>

                    <form onSubmit={handleSubmit}>
                        <VStack gap={4} align="stretch">
                            <Field.Root>
                                <Field.Label>Email</Field.Label>
                                <Input
                                    type="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    autoComplete="email"
                                />
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Password</Field.Label>
                                <Input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                                />
                            </Field.Root>

                            {error && (
                                <Text fontSize="sm" color="red.400">
                                    {error}
                                </Text>
                            )}
                            {info && (
                                <Text fontSize="sm" color="green.400">
                                    {info}
                                </Text>
                            )}

                            <Button
                                type="submit"
                                loading={submitting}
                                colorScheme="blue"
                                w="full"
                            >
                                {mode === "signin" ? "Sign in" : "Sign up"}
                            </Button>
                        </VStack>
                    </form>

                    <HStack gap={3}>
                        <Separator flex="1" />
                        <Text fontSize="xs" color="fg.muted">
                            or
                        </Text>
                        <Separator flex="1" />
                    </HStack>

                    <Button variant="outline" w="full" onClick={handleGoogle}>
                        <FcGoogle size={18} />
                        <Text ml={2}>Continue with Google</Text>
                    </Button>

                    <HStack gap={1} justify="center" fontSize="sm">
                        <Text color="fg.muted">
                            {mode === "signin" ? "Don't have an account?" : "Already have an account?"}
                        </Text>
                        <Button
                            variant="plain"
                            size="sm"
                            color="blue.400"
                            onClick={() => {
                                setMode(mode === "signin" ? "signup" : "signin");
                                setError(null);
                                setInfo(null);
                            }}
                        >
                            {mode === "signin" ? "Sign up" : "Sign in"}
                        </Button>
                    </HStack>
                </VStack>
            </Box>
        </Flex>
    );
}

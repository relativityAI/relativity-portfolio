import { Flex, Text, Box, Button, VStack } from "@chakra-ui/react";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "@/auth/useAuth";
import { useState } from "react";

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
                            Sign in to your workspace
                        </Text>
                    </VStack>

                    {error && (
                        <Text fontSize="sm" color="red.400" textAlign="center">
                            {error}
                        </Text>
                    )}

                    <Button
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

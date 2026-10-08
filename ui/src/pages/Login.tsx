import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Flex, Text, Box } from "@chakra-ui/react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/useAuth";

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

  return (
    <Flex className="landing" minH="calc(100vh - 44px)" align="center" justify="center" p={6} position="relative" overflow="hidden">
      <Helmet>
        <title>Sign in | Relativity</title>
        <meta name="description" content="Create custom research agents wired to live market data. Sign in with Google." />
      </Helmet>

      <Flex direction="column" align="center" w="100%" maxW="520px" gap={6}>
        <Text
          fontFamily="var(--font-display)"
          fontWeight={400}
          fontSize={{ base: "2xl", md: "3xl" }}
          letterSpacing="-0.01em"
          textAlign="center"
          textShadow="0 10px 40px -20px rgba(0,0,0,0.45)"
        >
          Relativity.
        </Text>

        <Text fontSize="sm" color="var(--ink-secondary)" textAlign="center" maxW="380px">
          Research agents wired to live market data.
        </Text>

        <Box mt={2} w="full" display="flex" justifyContent="center">
          {clientId ? (
            <Box ref={gsiRef} />
          ) : (
            <Text fontSize="sm" color="var(--signal-negative)" textAlign="center">
              Missing VITE_GOOGLE_CLIENT_ID.
            </Text>
          )}
        </Box>
      </Flex>
    </Flex>
  );
}

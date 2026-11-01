import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Box, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/useAuth";
import Footer from "@/components/Footer";

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
    <div className="landing h-full overflow-y-auto overflow-x-hidden bg-[var(--surface-canvas)] text-[var(--ink-primary)]">
      <Helmet>
        <title>Sign in | Relativity</title>
        <meta name="description" content="Create custom research agents wired to live market data. Sign in with Google." />
      </Helmet>

      <header className="px-4 md:px-8 py-4">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-[var(--ink-primary)] hover:opacity-60 transition-opacity select-none"
            >
              <ArrowLeft size={16} />
              Home page
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-[1500px] mx-auto px-4 md:px-8 pt-12 md:pt-20 pb-12 flex flex-col items-center text-center gap-6">
        <h1 className="text-[clamp(1.8rem,3.4vw,3rem)] leading-[1.1] font-light tracking-[-0.02em] max-w-[22ch] text-[var(--ink-primary)]">
          Agents watch the market, you watch the agents.
        </h1>

        <div className="mt-4 flex justify-center">
          {clientId ? (
            <Box ref={gsiRef} />
          ) : (
            <Text fontSize="sm" color="var(--signal-negative)">
              Missing VITE_GOOGLE_CLIENT_ID.
            </Text>
          )}
        </div>
      </section>

      <section className="px-4 md:px-8 pb-4">
        <p className="text-center text-xs md:text-sm text-[var(--ink-tertiary)] max-w-[46ch] mx-auto leading-relaxed">
          Not investment advice · no trade calls · no hidden ranking — research only.
        </p>
      </section>

      <Footer />
    </div>
  );
}

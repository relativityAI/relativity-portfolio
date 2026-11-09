import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Routes,
  Route,
  useLocation,
  useParams,
  Navigate
} from 'react-router';

import { Box, Flex, Spinner, Center } from "@chakra-ui/react";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import HomePage from "./pages/HomePage";
import AgentsList from "./pages/AgentsList";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import Stock from "./pages/Stock";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import ThankYou from "./pages/ThankYou";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";
import ApiKeySetupDialog from "./components/ApiKeySetupDialog";
import { MotionConfig, AnimatePresence, motion } from "motion/react";
import { page, dur, ease } from "@/lib/motion";
import { Toaster } from "./components/ui/toaster";
// My Workspace (shadcn/Tailwind island inside the Chakra app)
import ConsoleLayout from "./pages/console/ConsoleLayout";
import AgentLibrary from "./pages/console/AgentLibrary";
import AgentSkills from "./pages/console/AgentSkills";
import AgentTools from "./pages/console/AgentTools";
import AiBuilder from "./pages/console/AiBuilder";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" style={{ height: "100%" }} exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }}>
          <Center minH="100%">
            <Spinner size="lg" />
          </Center>
        </motion.div>
      ) : (
        <motion.div key="content" style={{ height: "100%" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
          {user ? children : <Navigate to="/login" replace />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Home() {
  const { loading } = useAuth();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" style={{ height: "100%" }} exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }}>
          <Center minH="100%">
            <Spinner size="lg" />
          </Center>
        </motion.div>
      ) : (
        <motion.div key="home" style={{ height: "100%" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
          <HomePage />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PageFallback() {
  return (
    <Center minH="60vh">
      <Spinner size="lg" />
    </Center>
  );
}

function UnknownRoute() {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  return user ? <Navigate to="/" replace /> : <NotFound />;
}

/** Old agent editor URLs open the workspace — deep-linked to the agent (or
 *  with the inline create form open for "new"). */
function AgentRedirect() {
  const { id } = useParams();
  if (!id || id === "new") return <Navigate to="/my-workspace?new=1" replace />;
  return <Navigate to={`/my-workspace?agent=${encodeURIComponent(id)}`} replace />;
}

/** Old /console URLs → /my-workspace, keeping the sub-path and query. */
function ConsoleLegacyRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={location.pathname.replace(/^\/console/, "/my-workspace") + location.search}
      replace
    />
  );
}

const PUBLIC_PATHS = ["/login", "/privacy", "/terms", "/thank-you", "/auth/callback"];

function AppRoutes() {
  const location = useLocation();
  const locationPath = location.pathname;
  const { user } = useAuth();

  // The route container is the scroller (window stays fixed) — without this
  // the next page inherits the previous scroll offset, and a shorter page
  // clamps straight to its bottom.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [locationPath]);

  useEffect(() => {
    const getTitle = (path: string) => {
      if (path === "/login") return "Sign in";
      if (path === "/") return user ? "New Analysis" : "Welcome";
      if (path === "/new-analysis") return "New Analysis";
      if (path === "/analysis") return "New Analysis";
      if (path === "/agents") return "Agents";
      if (path === "/agent/builder" || path.startsWith("/agent/builder/")) return "Agent Detail";
      if (path.startsWith("/agent/")) return "Agent Detail";
      if (path === "/analysis-list") return "Runs";
      if (path.startsWith("/analysis-result/")) return "Run Result";
      if (path.startsWith("/stock/")) return "Stock";
      if (path === "/settings") return "Settings";
      if (path === "/my-workspace" || path.startsWith("/my-workspace/")) return "My Workspace";
      return "Relativity AI";
    };

    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath, user]);

  const isLogin = locationPath === "/login";
  const isConsole = locationPath.startsWith("/my-workspace");
  const isPublicPage = PUBLIC_PATHS.includes(locationPath);
  // The new analysis page owns the whole viewport — no footer under it.
  // "/" is always footerless: HomePage renders its own.
  const isAnalysisPage =
    locationPath.startsWith("/analysis") ||
    locationPath === "/new-analysis" ||
    locationPath === "/";
  const showNav = !isLogin;
  // Remove footer from analysis result page (and analysis-related pages as requested)
  const showFooter = showNav && !isPublicPage && !isConsole && !isAnalysisPage && locationPath !== "/settings" && !locationPath.startsWith("/stock");

  return (
    <Flex direction="column" h="100dvh" overflow="hidden">
      {user && locationPath !== "/settings" && <ApiKeySetupDialog key={user.id} user={user} />}
      {showNav && <NavBar />}

        {/* One natural page scroller for every route — no inner scroll boxes. */}
        <Box ref={scrollRef} w="100%" flex={1} overflowY="auto" overflowX="hidden" paddingX={0}>
            <AnimatePresence mode="wait">
              <motion.div key={isConsole ? "console" : location.pathname} variants={page} style={{ height: "100%", maxWidth: "1200px", margin: "0 auto", paddingLeft: "1.5rem", paddingRight: "1.5rem" }} initial="initial" animate="animate" exit="exit">
                <Suspense fallback={<PageFallback />}>
                  <Routes location={location}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/" element={<Home />} />
                    <Route
                      path="/agent"
                      element={<Navigate to="/agents" replace />}
                    />
                    {/* Old builder / wizard URLs now open the console editor. */}
                    <Route path="/agent/builder" element={<AgentRedirect />} />
                    <Route path="/agent/builder/:id" element={<AgentRedirect />} />
                    <Route path="/agent/new" element={<AgentRedirect />} />
                    <Route path="/agent/:id" element={<AgentRedirect />} />
                    <Route
                      path="/agents"
                      element={
                        <Protected>
                          <AgentsList />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis-list"
                      element={
                        <Protected>
                          <AnalysisList />
                        </Protected>
                      }
                    />
                    <Route
                      path="/new-analysis"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis/:id"
                      element={
                        <Protected>
                          <Analysis />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis-result/:id"
                      element={
                        <Protected>
                          <AnalysisResult />
                        </Protected>
                      }
                    />
                    <Route
                      path="/analysis-result"
                      element={<Navigate to="/analysis-list" replace />}
                    />
                    <Route path="/stock/:symbol" element={<Stock />} />
                    <Route
                      path="/settings"
                      element={
                        <Protected>
                          <Settings />
                        </Protected>
                      }
                    />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/thank-you" element={<ThankYou />} />
                    <Route path="/index.html" element={<Navigate to="/" replace />} />
                    {/* My Workspace — shadcn/Tailwind shell. */}
                    <Route
                      path="/my-workspace"
                      element={
                        <Protected>
                          <ConsoleLayout />
                        </Protected>
                      }
                    >
                      <Route index element={<AgentLibrary />} />
                      <Route path="skills" element={<AgentSkills />} />
                      <Route path="builder" element={<AiBuilder />} />
                      <Route path="tools" element={<AgentTools />} />
                      {/* No agent editor page — the workspace list edits inline. */}
                      <Route path="agent/new" element={<AgentRedirect />} />
                      <Route path="agent/:id" element={<AgentRedirect />} />
                    </Route>
                    {/* Old /console URLs keep working. */}
                    <Route path="/console" element={<Navigate to="/my-workspace" replace />} />
                    <Route path="/console/*" element={<ConsoleLegacyRedirect />} />
                    <Route path="*" element={<UnknownRoute />} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
        </Box>

      {showFooter && <Footer />}
      <Toaster />
    </Flex>
  );
}

function App() {
  return (
    <AuthProvider>
      <MotionConfig reducedMotion="user">
        <AppRoutes />
      </MotionConfig>
    </AuthProvider>
  )
}

export default App

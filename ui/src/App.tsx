import { Suspense, useEffect, type ReactNode } from "react";
import Agent from "./pages/Agent";
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
import Landing from "./pages/Landing";
import AgentsList from "./pages/AgentsList";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import Settings from "./pages/Settings";
import Guide from "./pages/Guide";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import ThankYou from "./pages/ThankYou";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";
import CookieBanner from "./components/CookieBanner";
import ApiKeySetupDialog from "./components/ApiKeySetupDialog";
import { MotionConfig, AnimatePresence, motion } from "motion/react";
import { page, dur, ease } from "@/lib/motion";
import { Toaster } from "./components/ui/toaster";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }}>
          <Center minH="calc(100vh - 44px)">
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
  const { user, loading } = useAuth();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }}>
          <Center minH="calc(100vh - 44px)">
            <Spinner size="lg" />
          </Center>
        </motion.div>
      ) : (
        <motion.div key={user ? "analysis" : "landing"} style={{ height: "100%" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
          {user ? <Analysis /> : <Landing />}
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

/** Old standalone builder URLs now open the wizard directly. */
function BuilderRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/agent/${id}` : "/agent/new"} replace />;
}

const PUBLIC_PATHS = ["/login", "/privacy", "/terms", "/thank-you", "/auth/callback", "/guide"];

function AppRoutes() {
  const location = useLocation();
  const locationPath = location.pathname;
  const { user } = useAuth();

  useEffect(() => {
    const getTitle = (path: string) => {
      if (path === "/login") return "Sign in";
      if (path === "/") return user ? "New Analysis" : "Welcome";
      if (path === "/analysis") return "New Analysis";
      if (path === "/agents") return "Agents";
      if (path === "/agent/builder" || path.startsWith("/agent/builder/")) return "Agent Detail";
      if (path.startsWith("/agent/")) return "Agent Detail";
      if (path === "/analysis-list") return "Analysis List";
      if (path.startsWith("/analysis-result/")) return "Analysis Result";
      if (path === "/settings") return "Settings";
      if (path === "/guide") return "Guide";
      return "Relativity AI";
    };

    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath, user]);

  const isLogin = locationPath === "/login";
  const isLanding = locationPath === "/" && !user;
  const isPublicPage = PUBLIC_PATHS.includes(locationPath);
  const showNav = !isLogin && !isLanding;
  const showFooter = showNav && !isPublicPage;

  return (
    <Flex direction="column" h="100dvh" overflow="hidden">
      {user && locationPath !== "/settings" && <ApiKeySetupDialog key={user.id} user={user} />}
      {showNav && <NavBar />}

        <Box w="100%" flex={1} overflowY="auto" overflowX="hidden" paddingX={isLanding ? 0 : { base: 4, md: 16 }}>
            <AnimatePresence mode="wait">
              <motion.div key={location.pathname} variants={page} style={{ height: "100%" }} initial="initial" animate="animate" exit="exit">
                <Suspense fallback={<PageFallback />}>
                  <Routes location={location}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/" element={<Home />} />
                    <Route
                      path="/agent"
                      element={<Navigate to="/agents" replace />}
                    />
                    {/* Old standalone builder URLs now open the wizard directly. */}
                    <Route path="/agent/builder" element={<BuilderRedirect />} />
                    <Route path="/agent/builder/:id" element={<BuilderRedirect />} />
                    <Route
                      path="/agent/new"
                      element={
                        <Protected>
                          <Agent />
                        </Protected>
                      }
                    />
                    <Route
                      path="/agent/:id"
                      element={
                        <Protected>
                          <Agent />
                        </Protected>
                      }
                    />
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
                    <Route
                      path="/settings"
                      element={
                        <Protected>
                          <Settings />
                        </Protected>
                      }
                    />
                    <Route path="/guide" element={<Guide />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/thank-you" element={<ThankYou />} />
                    <Route path="/index.html" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<UnknownRoute />} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
        </Box>

      {showFooter && <Footer />}
      <CookieBanner />
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

import { Suspense, useEffect, type ReactNode } from "react";
import Agent from "./pages/Agent";
import AgentBuilder from "./pages/AgentBuilder";
import {
  Routes,
  Route,
  useLocation,
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

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div key="loading" exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }}>
          <Center minH="calc(100vh - 56px)">
            <Spinner size="lg" />
          </Center>
        </motion.div>
      ) : (
        <motion.div key="content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
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
          <Center minH="calc(100vh - 56px)">
            <Spinner size="lg" />
          </Center>
        </motion.div>
      ) : (
        <motion.div key={user ? "analysis" : "landing"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.base, ease }}>
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

const PUBLIC_PATHS = ["/login", "/privacy", "/terms", "/thank-you", "/auth/callback"];

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
      if (path === "/agent/builder" || path.startsWith("/agent/builder/")) return "Agent Builder";
      if (path.startsWith("/agent/")) return "Agent Detail";
      if (path === "/analysis-list") return "Analysis List";
      if (path.startsWith("/analysis-result/")) return "Analysis Result";
      if (path === "/settings") return "Settings";
      return "Relativity AI";
    };

    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath, user]);

  const isLogin = locationPath === "/login";
  const isLanding = locationPath === "/" && !user;
  const isPublicPage = PUBLIC_PATHS.includes(locationPath);
  const isBuilder = locationPath === "/agent/builder" || locationPath.startsWith("/agent/builder/");
  const showNav = !isLogin && !isLanding;
  const showFooter = showNav && !isPublicPage && !isBuilder;

  return (
    <Flex direction="column" h="100dvh" overflow="hidden">
      {user && locationPath !== "/settings" && <ApiKeySetupDialog user={user} />}
      {showNav && <NavBar />}

        <Box w="100%" flex={1} overflowY="auto" overflowX="hidden" paddingX={isLanding || isBuilder ? 0 : { base: 4, md: 16 }} marginY={isLanding || isBuilder ? 0 : 5}>
          {isBuilder ? (
            <Routes location={location}>
              <Route path="/agent/builder" element={<Protected><AgentBuilder /></Protected>} />
              <Route path="/agent/builder/:id" element={<Protected><AgentBuilder /></Protected>} />
            </Routes>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={location.pathname} variants={page} initial="initial" animate="animate" exit="exit">
                <Suspense fallback={<PageFallback />}>
                  <Routes location={location}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/" element={<Home />} />
                    <Route
                      path="/agent"
                      element={<Navigate to="/agents" replace />}
                    />
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
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/thank-you" element={<ThankYou />} />
                    <Route path="/index.html" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<UnknownRoute />} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          )}
        </Box>

      {showFooter && <Footer />}
      <CookieBanner />
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

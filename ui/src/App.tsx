// import './App.css'

import { useEffect, type ReactNode } from "react";
import Agent from "./pages/Agent";
import {
  Routes,
  Route,
  useLocation,
  Navigate
} from 'react-router';

import { Provider } from "@/components/ui/provider"
import { Box, Spinner, Center } from "@chakra-ui/react";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import Login from "./pages/Login";
import AgentsList from "./pages/AgentsList";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import Settings from "./pages/Settings";
import NavBar from "./components/NavBar";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Center minH="calc(100vh - 56px)">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const locationPath = useLocation().pathname;

  useEffect(() => {
    const getTitle = (path: string) => {
      if (path === "/login") return "Sign in";
      if (path === "/" || path === "/analysis") return "New Analysis";
      if (path === "/agents") return "Agents";
      if (path.startsWith("/agent/")) return "Agent Detail";
      if (path === "/analysis-list") return "Analysis List";
      if (path.startsWith("/analysis-result/")) return "Analysis Result";
      if (path === "/settings") return "Settings";
      return "Relativity AI";
    };

    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath]);

  const isLogin = locationPath === "/login";

  return (
    <AuthProvider>
      {!isLogin && <NavBar />}

      <Box w="100%" paddingX={{ base: 4, md: 16 }} marginY={5}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Analysis />
              </Protected>
            }
          />
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
        </Routes>
      </Box>
    </AuthProvider>
  );
}

function App() {
  return (
    <Provider>
      <AppRoutes />
    </Provider>
  )
}

export default App

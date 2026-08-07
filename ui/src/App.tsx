// import './App.css'

import { useEffect } from "react";
import Profile from "./pages/Profile";
import {
  Routes,
  Route,
  useLocation,
  Navigate
} from 'react-router';

import { Provider } from "@/components/ui/provider"
import { Box } from "@chakra-ui/react";
import ProfilesList from "./pages/ProfilesList";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import Settings from "./pages/Settings";
import NavBar from "./components/NavBar";


function App() {

  const locationPath = useLocation().pathname;
  
  useEffect(() => {
    const getTitle = (path: string) => {
      if (path === "/" || path === "/analysis") return "New Analysis";
      if (path === "/profiles") return "Profiles";
      if (path.startsWith("/profile/")) return "Profile Detail";
      if (path === "/analysis-list") return "Analysis List";
      if (path.startsWith("/analysis-result/")) return "Analysis Result";
      if (path === "/settings") return "Settings";
      return "Relativity AI";
    };
    
    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath]);

  return (
    <Provider>

      {/* Navbar */}
      <NavBar />

      <Box w="100%" paddingX={16} marginY={5}>
        <Routes>
          <Route path="/" element={<Analysis />} />
          <Route
            path="/profile"
            element={<Navigate to="/profiles" replace />}
          />
          <Route path="/profile/new" element={<Profile />} />
          <Route path="/profile/:id" element={<Profile />} />
          <Route path="/profiles" element={<ProfilesList />} />
          <Route path="/analysis-list" element={<AnalysisList />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/analysis/:id" element={<Analysis />} />
          <Route path="/analysis-result/:id" element={<AnalysisResult />} />
          <Route
            path="/analysis-result"
            element={<Navigate to="/analysis-list" replace />}
          />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Box>
    </Provider>
  )
}

export default App

// import './App.css'

import { useEffect } from "react";
import Dashboard from "./pages/Dashboard"
import Profile from "./pages/Profile";
import {
  Routes,
  Route,
  useLocation,
  Navigate
} from 'react-router';

import { Provider } from "@/components/ui/provider"
import { Container } from "@chakra-ui/react";
import ProfilesList from "./pages/ProfilesList";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import AnalysisResult from "./pages/AnalysisResult";
import NavBar from "./components/NavBar";


function App() {

  const locationPath = useLocation().pathname;
  
  useEffect(() => {
    const getTitle = (path: string) => {
      if (path === "/") return "Dashboard";
      if (path === "/profiles") return "Profiles";
      if (path.startsWith("/profile/")) return "Profile Detail";
      if (path === "/analysis-list") return "Analysis List";
      if (path.startsWith("/analysis-result/")) return "Analysis Result";
      if (path === "/analysis") return "New Analysis";
      return "Relativity AI";
    };
    
    document.title = `${getTitle(locationPath)} | Relativity AI`;
  }, [locationPath]);

  return (
    <Provider>

      {/* Navbar */}
      <NavBar />

      <Container paddingX={16} marginY={5}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/profile"
            element={<Navigate to="/profiles" replace />}
          />
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
        </Routes>
      </Container>
    </Provider>
  )
}

export default App

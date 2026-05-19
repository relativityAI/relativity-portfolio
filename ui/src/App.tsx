// import './App.css'

import Dashboard from "./pages/Dashboard"
import Profile from "./pages/Profile";
import Path from "./components/Path";
import {
  Routes,
  Route,
  useLocation,
  Navigate
} from 'react-router';

import { Provider } from "@/components/ui/provider"
import { Container } from "@chakra-ui/react";
import ProfilesList from "./pages/ProfilesList";
import DataSources from "./pages/DataSources";
import AnalysisList from "./pages/AnalysisList";
import Analysis from "./pages/Analysis";
import NavBar from "./components/NavBar";


function App() {

  let location = useLocation().pathname;
  location = "Dashboard" + location

  return (
    <Provider>

      {/* Navbar */}
      <NavBar />

      {/* Breadcrumbs */}
      <Path path={location} />

      <Container paddingX={16} marginY={5}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/profile"
            element={<Navigate to="/profiles" replace />}
          />
          <Route path="/profile/:id" element={<Profile />} />
          <Route path="/profiles" element={<ProfilesList />} />
          <Route path="/data-sources" element={<DataSources />} />
          <Route path="/analysis-list" element={<AnalysisList />} />
          <Route path="/analysis/:id" element={<Analysis />} />
          <Route path="/analysis"
            element={<Navigate to="/analysis-list" replace />}
          />
        </Routes>
      </Container>
    </Provider>
  )
}

export default App

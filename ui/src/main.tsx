import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom"
import { HelmetProvider } from "react-helmet-async"
import { Provider } from "@/components/ui/provider"

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <HelmetProvider>
        <Provider>
          <App />
        </Provider>
      </HelmetProvider>
    </BrowserRouter>
  </StrictMode>,
)

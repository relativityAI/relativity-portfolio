import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from "react-router"
import { HelmetProvider } from "react-helmet-async"
import { Provider } from "@/components/ui/provider"

import './index.css'
import App from './App.tsx'

const router = createBrowserRouter([
  { path: "*", element: <App /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <Provider>
        <RouterProvider router={router} />
      </Provider>
    </HelmetProvider>
  </StrictMode>,
)

/*
 * Design-preview harness for the analysis result page. NOT part of the app
 * build (dev-server only; the entry is never imported by main.tsx).
 * Mocks auth + API so the real page component renders with representative
 * data for design review in the browser:
 *   cd ui && npx vite --port 5199 &  then open  /design-preview.html
 * (design-preview.html is generated: sed main.tsx -> design-preview.tsx)
 */

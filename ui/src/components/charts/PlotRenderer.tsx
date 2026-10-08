import { lazy, Suspense } from "react";
import { Box, Text, Spinner } from "@chakra-ui/react";
import type { PlotSpec } from "@/types/plots";

const LightweightWrapper = lazy(() => import("./LightweightWrapper"));
const VegaLiteChart = lazy(() => import("./VegaLiteChart"));

interface Props {
  plots: PlotSpec[];
  activeInteractive?: boolean;
}

export default function PlotRenderer({ plots, activeInteractive = true }: Props) {
  if (!plots || plots.length === 0) return null;
  return (
    <Box display="flex" flexDir="column" gap={6} mt={4}>
      {plots.map((p) => (
        <Box key={p.id} border="1px solid var(--hairline)" borderRadius="2px" p={3} bg="var(--card)">
          {p.title && (
            <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" mb={2}>
              {p.title}
            </Text>
          )}
          <Suspense fallback={<Spinner size="sm" />}>
            {p.type === "lightweight" && (
              <LightweightWrapper spec={p.spec} data={Array.isArray(p.data) ? (p.data as any) : []} />
            )}
            {p.type === "vega-lite" && <VegaLiteChart spec={p.spec} data={p.data} />}
            {p.type === "mermaid" && (
              <Box fontFamily="var(--font-mono)" fontSize="12px" color="var(--ink-secondary)">
                {typeof p.data === "string" ? p.data : JSON.stringify(p.data)}
              </Box>
            )}
          </Suspense>
          {p.caption && (
            <Text fontSize="11px" color="var(--ink-tertiary)" mt={1.5}>
              {p.caption}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

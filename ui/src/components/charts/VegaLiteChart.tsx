import { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";

interface VegaLiteProps {
  spec: any;
  data?: any;
  width?: number;
  height?: number;
}

export default function VegaLiteChart({ spec, data, width = 680, height = 320 }: VegaLiteProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const vegaEmbed = (await import("vega-embed")).default;
        if (!mounted || !ref.current) return;
        const merged: any = {
          ...spec,
          data: spec?.data ?? (data ? { values: data } : undefined),
          width: spec?.width ?? width,
          height: spec?.height ?? height,
          background: "transparent",
        };
        await vegaEmbed(ref.current, merged, { actions: false });
      } catch (e) {
        // best effort, ignore if not installed
      }
    })();
    return () => {
      mounted = false;
    };
  }, [spec, data, width, height]);
  return <Box ref={ref} w="100%" overflowX="auto" />;
}

import type { ReactNode } from "react";
import { Box } from "@chakra-ui/react";

export default function PageHero({ children }: { children: ReactNode }) {
    return (
        <Box
            position="relative"
            overflow="hidden"
            borderRadius="2px"
            border="1px solid var(--hairline)"
            bg="var(--surface-panel)"
            px={{ base: 4, md: 6 }}
            py={{ base: 5, md: 6 }}
        >
            <Box
                position="absolute"
                inset={0}
                pointerEvents="none"
                aria-hidden
                style={{
                    backgroundImage:
                        "linear-gradient(to right, var(--hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--hairline) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                    opacity: 0.4,
                    maskImage: "radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.85), transparent 72%)",
                    WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.85), transparent 72%)",
                }}
            />
            <Box position="relative">{children}</Box>
        </Box>
    );
}
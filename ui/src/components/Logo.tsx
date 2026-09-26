import { Text, Flex } from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import logoLight from "@/assets/logo-light.png";
import logoDark from "@/assets/logo-dark.png";

type Preset = "nav" | "landing" | "login";

const PRESETS: Record<Preset, { height: number; radius: number; textSize?: string | Record<string, string>; letterSpacing?: string; showWord: boolean }> = {
  nav: { height: 20, radius: 5, textSize: { base: "xs", md: "sm" }, showWord: true },
  // Wordmark cap-height is tuned to match the 34px mark so the lockup reads
  // as one unit rather than a big glyph with a small word beside it.
  landing: { height: 34, radius: 8, textSize: "xl", letterSpacing: "0.14em", showWord: true },
  login: { height: 22, radius: 8, textSize: "xs", letterSpacing: "0.2em", showWord: true },
};

/**
 * Theme-aware brand mark. Renders the dark glyph in light mode and the light
 * glyph in dark mode so the mark always sits on a contrasting background.
 */
export default function Logo({ preset = "nav", showWordmark = true }: { preset?: Preset; showWordmark?: boolean }) {
  const src = useColorModeValue(logoLight, logoDark);
  const p = PRESETS[preset];
  if (!p.showWord || !showWordmark) {
    return <img src={src} alt="Relativity" style={{ height: p.height, width: "auto", borderRadius: p.radius, flexShrink: 0 }} />;
  }
  return (
    <Flex align="center" gap={2} minW={0}>
      <img src={src} alt="Relativity" style={{ height: p.height, width: "auto", borderRadius: p.radius, flexShrink: 0 }} />
      <Text
        fontWeight="bold"
        fontFamily="var(--font-mono)"
        fontSize={p.textSize}
        letterSpacing={p.letterSpacing ?? "tight"}
        color="var(--ink-primary)"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        css={{ "@media (max-width: 379px)": { display: "none" } }}
      >
        RELATIVITY
      </Text>
    </Flex>
  );
}

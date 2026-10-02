import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { agentAvatarSvg } from "@/lib/agentIdentity";
import AgentAvatar from "@/components/shared/AgentAvatar";
import UserAvatar from "@/components/shared/UserAvatar";

const wrap = (n: React.ReactNode) => (
  <ChakraProvider value={createSystem(defaultConfig)}>
    <ThemeProvider attribute="class" defaultTheme="dark">{n}</ThemeProvider>
  </ChakraProvider>
);

describe("agent portraits", () => {
  // DiceBear emits viewBox with no width/height. Anything that leaves the
  // portrait unsized renders a bare tint chip with no face in it.
  it("agentAvatarSvg is self-sizing", () => {
    expect(agentAvatarSvg("Technical Analysis Agent")).toMatch(
      /^<svg [^>]*width="100%"[^>]*height="100%"/,
    );
  });

  it("AgentAvatar gives the portrait a sized parent", () => {
    const html = renderToStaticMarkup(wrap(<AgentAvatar agent="Technical Analysis Agent" size={44} />));
    // Sized parent = inline style, NOT a dropped `css` prop.
    expect(html).toMatch(/style="[^"]*width:90%/);
    expect(html).toMatch(/style="[^"]*height:90%/);
    expect(html).toContain("sepia(0.52)");
    expect(html).toMatch(/<svg [^>]*width="100%"/);
  });

  it("UserAvatar portrait is self-sizing", () => {
    const html = renderToStaticMarkup(wrap(<UserAvatar seed="a@b.com" size={26} />));
    expect(html).toMatch(/<svg [^>]*width="100%"[^>]*height="100%"/);
  });
});

/** Bisect which part of the report document hangs react-pdf layout. */
import { statSync } from "node:fs";
import React from "react";
import ReactPDF, { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const f = (p: string) => req.resolve(p).replace(/\\/g, "/");
Font.register({
  family: "Inter",
  fonts: [
    { src: f("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf") },
    { src: f("@expo-google-fonts/inter/400Regular_Italic/Inter_400Regular_Italic.ttf"), fontStyle: "italic" },
    { src: f("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "JetBrains Mono",
  fonts: [
    { src: f("@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf") },
    { src: f("@expo-google-fonts/jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf"), fontWeight: 700 },
  ],
});

const variant = process.argv[2] || "cover";

// Real chip images, same as the report uses.
import { agentChipPng, agentSeed, providerChipPng } from "./src/agentIdentity.js";
import { LOGO_PNG_DATA_URI } from "./src/reportLogo.js";
const chip = agentChipPng(agentSeed("GARP Fund"), 128);
const provider = providerChipPng("openai/gpt-4o-mini");
const logoBuf = Buffer.from(LOGO_PNG_DATA_URI.slice(LOGO_PNG_DATA_URI.indexOf(",") + 1), "base64");

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, paddingTop: 46, paddingBottom: 58, paddingHorizontal: 48 },
  row: { flexDirection: "row", alignItems: "center" },
});

const Cover = () => (
  <>
    <Text style={{ fontFamily: "Inter", fontWeight: 700, fontSize: 24, color: "#101215" }}>Reliance Industries</Text>
    <View style={s.row}>
      <Image style={{ width: 44, height: 44, marginRight: 12 }} src={{ data: chip, format: "png" }} />
      <View>
        <Text>GARP Fund</Text>
        <View style={s.row}>
          <Image style={{ width: 11, height: 11, marginRight: 5 }} src={{ data: provider, format: "png" }} />
          <Text style={{ fontFamily: "JetBrains Mono", fontSize: 8 }}>openai/gpt-4o-mini · 28/09/2026</Text>
        </View>
      </View>
    </View>
    <View style={{ borderWidth: 1, borderColor: "#D9D9D5", marginTop: 12, padding: 14 }}>
      <Text style={{ fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 40, color: "#1E7F4B" }}>62.4</Text>
    </View>
    <Image style={{ width: 15, height: 11.5 }} src={{ data: logoBuf, format: "png" }} />
  </>
);

const BlockBits = () => (
  <>
    <View style={{ borderWidth: 1, borderColor: "#D9D9D5", padding: 10, marginTop: 6 }} wrap={false}>
      <Text style={{ fontSize: 9.5, fontWeight: 600, marginBottom: 6 }}>Plate title</Text>
      <Image style={{ width: "100%", aspectRatio: 1.9375 }} src={{ data: chip, format: "png" }} />
    </View>
    <View style={{ borderWidth: 1, borderColor: "#D9D9D5", marginTop: 8 }} wrap>
      {[0, 1, 2].map((r) => (
        <View key={r} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#D9D9D5" }} wrap={false}>
          <Text style={{ padding: 4, fontSize: 8, flexGrow: 1 }}>Metric {r}</Text>
          <Text style={{ padding: 4, fontSize: 8, fontFamily: "JetBrains Mono", textAlign: "right", minWidth: 44, flexGrow: 0.7 }}>{62.4 + r}</Text>
        </View>
      ))}
    </View>
    <Text style={{ fontFamily: "JetBrains Mono", fontSize: 7 }} render={({ pageNumber, totalPages }: any) => `page ${pageNumber} of ${totalPages}`} />
  </>
);

const SkillBits = () => (
  <View>
    <View style={{ flexDirection: "row", alignItems: "baseline" }} wrap={false}>
      <Text style={{ fontFamily: "JetBrains Mono", fontSize: 10, fontWeight: 600, color: "#23747D", marginRight: 7 }}>01</Text>
      <Text style={{ fontSize: 14, fontWeight: 700 }}>Profitability Quality</Text>
      <Text style={{ fontFamily: "JetBrains Mono", fontSize: 10, fontWeight: 600, marginLeft: "auto" }}>70</Text>
    </View>
    <View style={{ borderTopWidth: 1, borderTopColor: "#D9D9D5", paddingTop: 6 }}>
      <View style={{ flexDirection: "row", marginTop: 5 }} wrap={false}>
        <Text style={{ fontSize: 8.5, flex: 1, paddingRight: 8 }}>Operating margin trend — 38.4% → 39.1% over four quarters</Text>
        <Text style={{ fontFamily: "JetBrains Mono", fontSize: 7, fontWeight: 600, borderWidth: 1, borderColor: "#1E7F4B", color: "#1E7F4B", paddingVertical: 1.5, paddingHorizontal: 5, textAlign: "center" }}>YES</Text>
      </View>
    </View>
  </View>
);

const Doc = () => (
  <Document>
    <Page size="A4" style={s.page}>
      {variant === "cover" || variant === "all" ? <Cover /> : null}
      {variant === "blocks" || variant === "all" ? <BlockBits /> : null}
      {variant === "skills" || variant === "all" ? <SkillBits /> : null}
    </Page>
  </Document>
);

const out = `/tmp/bisect-${variant}.pdf`;
await ReactPDF.renderToFile(<Doc />, out);
console.log(`${variant} ok bytes:`, statSync(out).size);

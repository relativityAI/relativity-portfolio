/** Bisect 2: the fixed masthead and the absolute+fixed footer combos. */
import { statSync } from "node:fs";
import React from "react";
import ReactPDF, { Document, Page, View, Text, StyleSheet, Font } from "@react-pdf/renderer";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const f = (p: string) => req.resolve(p).replace(/\\/g, "/");
Font.register({
  family: "Inter",
  fonts: [
    { src: f("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf") },
    { src: f("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "JetBrains Mono",
  fonts: [{ src: f("@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf") }],
});

const variant = process.argv[2] || "masthead";
const PAGE = { x: 48, top: 46, bottom: 58 };

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, paddingTop: PAGE.top, paddingBottom: PAGE.bottom, paddingHorizontal: PAGE.x },
  masthead: { height: 6, backgroundColor: "#101215", marginTop: -PAGE.top, marginHorizontal: -PAGE.x, marginBottom: 18 },
  footer: { position: "absolute", bottom: 24, left: PAGE.x, right: PAGE.x, flexDirection: "row", borderTopWidth: 1, borderTopColor: "#D9D9D5", paddingTop: 7 },
  fill: { fontSize: 9 },
});

const Masthead = () => <View style={s.masthead} fixed />;
const Footer = () => (
  <View style={s.footer} fixed>
    <Text style={{ fontFamily: "JetBrains Mono", fontSize: 7, color: "#8B929C" }}>Relativity · RELIANCE</Text>
    <Text style={{ fontFamily: "JetBrains Mono", fontSize: 7, marginLeft: "auto" }} render={({ pageNumber, totalPages }: any) => `page ${pageNumber} of ${totalPages}`} />
  </View>
);
const Filler = () =>
  Array.from({ length: 40 }, (_, i) => <Text key={i} style={s.fill}>Filler paragraph {i} — the quick brown fox jumps over the lazy dog repeatedly to force pagination.</Text>);

const Doc = () => (
  <Document>
    <Page size="A4" style={s.page}>
      {(variant === "masthead" || variant === "both") && <Masthead />}
      <Filler />
      {(variant === "footer" || variant === "both") && <Footer />}
    </Page>
  </Document>
);

const out = `/tmp/bisect2-${variant}.pdf`;
await ReactPDF.renderToFile(<Doc />, out);
console.log(`${variant} ok bytes:`, statSync(out).size);

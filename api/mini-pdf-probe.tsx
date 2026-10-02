/** Minimal bisect probe: fonts + basic layout only. */
import { statSync } from "node:fs";
import React from "react";
import ReactPDF, { Document, Page, Text, StyleSheet, Font } from "@react-pdf/renderer";
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

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 10, paddingTop: 40, paddingHorizontal: 48 },
  big: { fontFamily: "JetBrains Mono", fontSize: 30, fontWeight: 700 },
  it: { fontStyle: "italic" },
});

const Doc = () => (
  <Document>
    <Page size="A4" style={s.page}>
      <Text style={s.big}>62.4</Text>
      <Text>Plain Inter text renders.</Text>
      <Text style={s.it}>Italic quote renders.</Text>
      <Text style={{ fontFamily: "JetBrains Mono", fontSize: 8 }}>mono caption · 12,345</Text>
    </Page>
  </Document>
);

await ReactPDF.renderToFile(<Doc />, "/tmp/mini.pdf");
console.log("mini ok bytes:", statSync("/tmp/mini.pdf").size);

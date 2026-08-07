declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: any;
  }
  const pdfParse: (buffer: Buffer) => Promise<PdfParseResult>;
  export default pdfParse;
}

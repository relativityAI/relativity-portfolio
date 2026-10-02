import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

/**
 * Document attachments for the AI Builder. Files staged in the composer are
 * uploaded to BuilderService.uploadDocuments when the message sends; the
 * extracted text rides along as an attachment content part, and the builder
 * endpoint reads it from the message's attachment parts.
 *
 * This replaces the old hidden-input + chip row: staging, progress, removal,
 * and the send flow are the official assistant-ui composer behavior.
 */

export class DocumentAttachmentAdapter implements AttachmentAdapter {
    // Text-based formats upload as extracted text; pdf/doc get server-side
    // extraction via BuilderService.uploadDocuments.
    accept = [
        ".txt", ".md", ".markdown", ".mdx", ".rst", ".log",
        ".pdf", ".doc", ".docx", ".rtf", ".odt",
        ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".env",
        ".xml", ".html", ".htm", ".svg", ".css", ".scss", ".less",
        ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt",
        ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh", ".bash", ".sql", ".r",
        "text/*", "application/json", "application/xml", "application/pdf",
        "application/x-yaml", "application/toml",
    ].join(",");

    async add({ file }: { file: File }): Promise<PendingAttachment> {
        // status is required: the runtime reads status.type when sending and
        // when deciding whether an attachment still needs uploading.
        return {
            id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: "document",
            name: file.name,
            file,
            status: { type: "requires-action", reason: "composer-send" },
        } as PendingAttachment;
    }

    async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
        const file = (attachment as any).file as File | undefined;
        if (!file) throw new Error("The document file is missing — remove it and attach again.");

        const result = await BuilderServiceProxy.upload(file);
        return {
            id: attachment.id,
            type: "document",
            name: attachment.name,
            status: { type: "complete" },
            content: [
                {
                    type: "text" as const,
                    text: `Reference document "${attachment.name}" (${result.charCount ?? "?"} characters):\n\n${result.text}`,
                },
            ],
        } as CompleteAttachment;
    }

    async remove(): Promise<void> {
        // Nothing to clean up server-side; the upload happens at send time.
    }
}

/**
 * Indirection so this module stays import-safe in tests: the real service is
 * resolved lazily from @/db.
 */
const BuilderServiceProxy = {
    async upload(file: File): Promise<{ text: string; charCount?: number }> {
        const { BuilderService } = await import("@/db");
        const result = await BuilderService.uploadDocuments([file]);
        const doc = result.documents?.[0];
        return { text: doc?.text || "", charCount: doc?.char_count };
    },
};

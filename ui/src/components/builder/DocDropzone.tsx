import { useState, useCallback, useRef } from "react";
import { Box, Flex, Text, IconButton } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdClose, MdDescription } from "react-icons/md";

interface DocFile {
  filename: string;
  char_count: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

interface DocDropzoneProps {
  onUpload: (files: File[]) => void;
  documents: DocFile[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}

const ACCEPT = ".pdf,.txt,.md,.csv,.docx,.json";

export default function DocDropzone({ onUpload, documents, onRemove, disabled }: DocDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(pdf|txt|md|csv|docx|json)$/i.test(f.name),
      );
      if (files.length > 0) onUpload(files);
    },
    [onUpload, disabled],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onUpload(files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onUpload],
  );

  const borderColor = isDragging ? "var(--accent-primary)" : "var(--hairline)";
  const bgColor = isDragging ? "var(--surface-recessed)" : "transparent";

  return (
    <Box>
      <Box
        onDragOver={(e: React.DragEvent) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        border="1px dashed"
        borderColor={borderColor}
        borderRadius="4px"
        bg={bgColor}
        p={3}
        cursor={disabled ? "default" : "pointer"}
        transition="all 150ms"
        _hover={
          disabled
            ? undefined
            : { borderColor: "var(--ink-tertiary)", bg: "var(--surface-recessed)" }
        }
      >
        <Flex direction="column" align="center" gap={1}>
          <Text fontSize="12px" color="var(--ink-secondary)" textAlign="center">
            Drop documents here or click to browse
          </Text>
          <Text fontSize="11px" color="var(--ink-tertiary)" textAlign="center">
            PDF, TXT, MD, CSV, DOCX, JSON — text extraction only, no images
          </Text>
        </Flex>
      </Box>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      <AnimatePresence>
        {documents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Flex direction="column" gap={1} mt={2}>
              {documents.map((doc, i) => (
                <Flex
                  key={doc.filename}
                  align="center"
                  gap={2}
                  px={2}
                  py={1.5}
                  borderRadius="3px"
                  bg="var(--surface-recessed)"
                  border="1px solid var(--hairline)"
                >
                  <MdDescription size={13} color="var(--ink-tertiary)" />
                  <Text fontSize="12px" color="var(--ink-primary)" flex={1} truncate>
                    {doc.filename}
                  </Text>
                  {doc.status === "uploading" || doc.status === "processing" ? (
                    <Text fontSize="11px" color="var(--ink-tertiary)">
                      Processing...
                    </Text>
                  ) : doc.status === "error" ? (
                    <Text fontSize="11px" color="var(--signal-negative)">
                      {doc.error || "Error"}
                    </Text>
                  ) : (
                    <Text fontSize="11px" color="var(--ink-tertiary)">
                      {(doc.char_count / 1000).toFixed(1)}k chars
                    </Text>
                  )}
                  {onRemove && doc.status !== "processing" && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      color="var(--ink-tertiary)"
                      _hover={{ color: "var(--signal-negative)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(i);
                      }}
                      aria-label="Remove document"
                    >
                      <MdClose size={12} />
                    </IconButton>
                  )}
                </Flex>
              ))}
            </Flex>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
}

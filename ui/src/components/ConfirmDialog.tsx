import { Box, Text, Button, HStack } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdClose, MdWarningAmber } from "react-icons/md";
import { dur, ease } from "@/lib/motion";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onCancel: () => void;
    onConfirm: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = "Delete",
    onCancel,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <AnimatePresence>
            {open && (
                <Box
                    as={motion.div}
                    position="fixed"
                    inset={0}
                    zIndex={1400}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: dur.fast, ease }}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    p={4}
                    onClick={onCancel}
                >
                    <Box
                        position="absolute"
                        inset={0}
                        bg="rgba(0,0,0,0.45)"
                        backdropFilter="blur(2px)"
                    />
                    <Box
                        as={motion.div}
                        position="relative"
                        w={{ base: "100%", md: "360px" }}
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="10px"
                        boxShadow="0 16px 48px rgba(0,0,0,0.18)"
                        p={0}
                        overflow="hidden"
                        initial={{ opacity: 0, scale: 0.94, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 6 }}
                        transition={{ duration: dur.base, ease }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <HStack align="center" spacing={2.5} px={4} pt={3.5}>
                            <Box
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                w="30px"
                                h="30px"
                                borderRadius="8px"
                                bg="color-mix(in srgb, var(--signal-negative) 14%, transparent)"
                                color="var(--signal-negative)"
                                flexShrink={0}
                            >
                                <MdWarningAmber size={17} />
                            </Box>
                            <Text
                                fontSize="14px"
                                fontWeight={600}
                                color="var(--ink-primary)"
                                flex={1}
                                minW={0}
                            >
                                {title}
                            </Text>
                            <Button
                                variant="subtle"
                                size="sm"
                                minW="auto"
                                h="auto"
                                p="2px"
                                color="var(--ink-tertiary)"
                                borderRadius="6px"
                                aria-label="Close"
                                onClick={onCancel}
                            >
                                <MdClose size={16} />
                            </Button>
                        </HStack>
                        <Text
                            fontSize="12.5px"
                            lineHeight="short"
                            color="var(--ink-secondary)"
                            px={4}
                            pt={1.5}
                            pb={3}
                        >
                            {message}
                        </Text>
                        <HStack
                            spacing={2}
                            px={4}
                            py={3}
                            bg="var(--surface-recessed)"
                            borderTop="1px solid var(--hairline)"
                        >
                            <Button
                                variant="subtle"
                                size="sm"
                                flex={1}
                                h="34px"
                                fontSize="13px"
                                fontWeight={500}
                                color="var(--ink-secondary)"
                                onClick={onCancel}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                flex={1}
                                h="34px"
                                fontSize="13px"
                                fontWeight={600}
                                variant="surface"
                                colorPalette="red"
                                onClick={onConfirm}
                            >
                                {confirmLabel}
                            </Button>
                        </HStack>
                    </Box>
                </Box>
            )}
        </AnimatePresence>
    );
}

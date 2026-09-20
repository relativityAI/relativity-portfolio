import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Flex, Text, Button, Tabs } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdClose, MdCheck, MdOutlineAutoAwesome } from "react-icons/md";
import { BuilderService, VoyagerService, AnalysisService, SettingsService } from "@/db";
import { toaster } from "@/components/ui/toaster";
import ChatPanel from "@/components/builder/ChatPanel";
import AgentPreviewPanel from "@/components/builder/AgentPreviewPanel";
import AgentActivity from "@/components/shared/AgentActivity";
import type { BuilderStep } from "@/components/builder/StepsTrace";
import type { ChatMsg } from "@/components/builder/ChatBubble";
import { diffDraft, type ChangeItem } from "@/lib/draftDiff";
import { draftKey, saveLocalDraft, loadLocalDraft, clearLocalDraft } from "@/lib/autosave";
import { type, tap } from "@/lib/tokens";

let msgId = 0;
function nextMsgId() {
  return `msg-${++msgId}-${Date.now()}`;
}

interface DocFile {
  filename: string;
  char_count: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

interface SavedChat {
  messages: ChatMsg[];
  proposal: Record<string, unknown>;
  documents: DocFile[];
  documentTexts: { filename: string; text: string }[];
  traces: { key: string; title: string; steps: BuilderStep[] }[];
}

function normalizeAgent(a: any): Record<string, unknown> {
  const phil = a?.persona?.philosophy_and_mindset ?? a?.philosophy ?? "";
  return {
    name: a?.name || "",
    persona: { philosophy_and_mindset: phil },
    configuration: { ...(a?.configuration || {}) },
    asset_evaluation: {
      qualitative: a?.asset_evaluation?.qualitative ?? a?.qualitative ?? [],
      quantitative: a?.asset_evaluation?.quantitative ?? [],
    },
    macro_evaluation: {
      qualitative: a?.macro_evaluation?.qualitative ?? [],
      quantitative: a?.macro_evaluation?.quantitative ?? [],
    },
  };
}

function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const next = { ...obj };
  const last = keys[keys.length - 1];
  const target = keys.slice(0, -1).reduce((acc, k) => {
    const nested = { ...((acc[k] as Record<string, unknown>) || {}) };
    acc[k] = nested;
    return nested;
  }, next);
  target[last] = value;
  return next;
}

interface DraftWithAiPanelProps {
  open: boolean;
  onClose: () => void;
  agent: any;
  agentId: string | null;
  /** Merge the accepted proposal into the shared wizard agent state. */
  onApply: (proposal: Record<string, unknown>) => void;
}

export default function DraftWithAiPanel({ open, onClose, agent, agentId, onApply }: DraftWithAiPanelProps) {
  const base = normalizeAgent(agent);

  const [proposal, setProposal] = useState<Record<string, unknown>>(() => normalizeAgent(agent));
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [documents, setDocuments] = useState<DocFile[]>([]);
  const [documentTexts, setDocumentTexts] = useState<{ filename: string; text: string }[]>([]);
  const [metrics, setMetrics] = useState<{ id: string; name: string; type: string }[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [presetKeys, setPresetKeys] = useState<string[]>([]);
  const [liveSteps, setLiveSteps] = useState<BuilderStep[] | null>(null);
  const [traces, setTraces] = useState<{ key: string; title: string; steps: BuilderStep[] }[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [tab, setTab] = useState<"chat" | "preview">("chat");

  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const processingRef = useRef(false);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const turnCount = useRef(0);
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `builder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const persistKey = agentId ? `${draftKey(agentId)}:builder` : `${draftKey("new")}:builder`;

  // Reset proposal to the shared agent whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    setProposal(normalizeAgent(agent));
  }, [open, agent]);

  // Restore the chat + draft from local storage (sessionId gives a unique key).
  useEffect(() => {
    if (!open) return;
    const saved = loadLocalDraft<SavedChat>(persistKey);
    if (saved && saved.data.messages?.length) {
      setMessages(saved.data.messages);
      setProposal({ ...normalizeAgent(agent), ...saved.data.proposal });
      setDocuments(saved.data.documents || []);
      setDocumentTexts(saved.data.documentTexts || []);
      setTraces(saved.data.traces || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autosave the chat to this device so a refresh never loses the conversation.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      saveLocalDraft<SavedChat>(persistKey, {
        messages,
        proposal,
        documents,
        documentTexts,
        traces,
      });
    }, 600);
    return () => clearTimeout(t);
}, [open, persistKey, messages, proposal, documents, documentTexts, traces]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    VoyagerService.getAvailableMetrics("NSE")
      .then((data) => { if (data?.fields) setMetrics(data.fields); })
      .catch(() => {});

    Promise.all([
      AnalysisService.getAvailableModels(),
      SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
      AnalysisService.getDefaultModel().catch(() => ({ model_id: "" })),
    ])
      .then(([modelsData, settings, def]) => {
        const allModels = Array.isArray(modelsData) ? modelsData : [];
        const keys = Object.keys(settings?.llm_keys || {});
        const models = keys.length > 0
          ? allModels.filter((m: string) => {
              const provider = m.split("/")[0];
              return provider === "ollama" || keys.includes(provider);
            })
          : allModels;
        setAvailableModels(models);
        setSelectedModel((prev) => {
          if (prev && models.includes(prev)) return prev;
          const recommended = models.includes(def?.model_id || "") ? def.model_id : "";
          return recommended || models[0] || "";
        });
      })
      .catch(() => {});

    BuilderService.getPresets()
      .then((presets) => setPresetKeys(presets.map((p: { key: string }) => p.key)))
      .catch(() => {});
  }, []);

  const clearStepTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }, []);

  const beginSteps = useCallback((titles: { label: string; detail?: string }[]) => {
    clearStepTimers();
    const n = titles.length;
    setLiveSteps(titles.map((t, i) => ({
      ...t,
      status: i === 0 || i === n - 1 ? ("active" as const) : ("pending" as const),
    })));
    titles.forEach((_, i) => {
      if (i >= n - 1) return;
      const idx = i;
      stepTimers.current.push(setTimeout(() => {
        setLiveSteps((prev) => prev?.map((s, j) => (j <= idx ? { ...s, status: "done" as const } : s)) ?? prev);
      }, 200 + idx * 280));
    });
  }, [clearStepTimers]);

  const finalizeSteps = useCallback((extra?: { label: string; detail?: string }) => {
    clearStepTimers();
    const baseSteps = (liveSteps ?? []).map((s) => ({ ...s, status: "done" as const }));
    const final = extra ? [...baseSteps, { ...extra, status: "done" as const }] : baseSteps;
    if (final.length > 0) {
      turnCount.current += 1;
      const title = `Assist round ${turnCount.current}`;
      setTraces((prev) => [...prev, { key: `${title}-${Date.now()}`, title, steps: final }]);
    }
    setLiveSteps(null);
  }, [clearStepTimers, liveSteps]);

  const recordProposal = useCallback((next: Record<string, unknown>): boolean => {
    const prev = proposalRef.current;
    if (JSON.stringify(prev) === JSON.stringify(next)) return false;
    setProposal(next);
    return true;
  }, []);

  const callBuilder = useCallback(async (userResponse: string, messagesSnapshot: ChatMsg[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const validation = await AnalysisService.validateModel(selectedModel || "");
      if (!validation.valid) {
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: "assistant",
          content: `Model validation failed: ${validation.error || "Unknown error."}`,
          timestamp: Date.now(),
        }]);
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Error checking model: ${err.message || String(err)}`,
        timestamp: Date.now(),
      }]);
      processingRef.current = false;
      setIsProcessing(false);
      return;
    }

    let searched: { label: string; detail?: string; links?: { label: string; url: string }[] } | undefined;
    try {
      const stepTitles: { label: string; detail?: string }[] = [];
      if (documentTexts.length > 0) {
        stepTitles.push({
          label: `Read ${documentTexts.length} document${documentTexts.length === 1 ? "" : "s"}`,
          detail: documentTexts.map((d) => d.filename).join(", "),
        });
      }
      stepTitles.push({ label: "Compiled your preferences & current draft" });
      stepTitles.push({ label: `Called ${selectedModel || "default model"}`, detail: "Awaiting model response" });
      beginSteps(stepTitles);

      const response = await BuilderService.draft({
        session_id: sessionIdRef.current,
        messages: messagesSnapshot.map((m) => ({ role: m.role, content: m.content })),
        agent_draft: proposalRef.current,
        metrics,
        document_texts: documentTexts,
        user_response: userResponse,
        model_id: selectedModel || undefined,
      });

      searched = response.sources?.length
        ? {
            label: "Searched the web",
            detail: response.sources.join("\n"),
            links: (response.search_results || []).map((r) => ({ label: r.title, url: r.url })),
          }
        : undefined;

      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: response.message,
        options: response.options,
        annotations: response.annotations,
        timestamp: Date.now(),
      }]);

      if (response.agent_draft_update) {
        const prev = proposalRef.current;
        const update = response.agent_draft_update;
        const phil = (update.philosophy as string) || (update.persona as any)?.philosophy_and_mindset || (prev.persona as any)?.philosophy_and_mindset || (prev.philosophy as string);
        const merged = {
          ...prev,
          ...update,
          persona: { ...(prev.persona as any), ...(update.persona as any), philosophy_and_mindset: phil },
          configuration: { ...(prev.configuration as any), ...(update.configuration as any) },
          asset_evaluation: { ...(prev.asset_evaluation as any), ...(update.asset_evaluation as any) },
          macro_evaluation: { ...(prev.macro_evaluation as any), ...(update.macro_evaluation as any) },
        };
        const changed = Object.keys(update).some((k) => JSON.stringify(update[k]) !== JSON.stringify(prev[k]));
        if (changed) recordProposal(merged);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error || (err instanceof Error ? err.message : String(err));
      console.error("[Builder]", msg, err);
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Something went wrong: ${msg.slice(0, 300)}. Please try again.`,
        timestamp: Date.now(),
      }]);
    } finally {
      processingRef.current = false;
      finalizeSteps(searched);
      setIsProcessing(false);
    }
  }, [metrics, documentTexts, selectedModel, beginSteps, finalizeSteps, recordProposal]);

  const handleSendMessage = useCallback((text: string) => {
    const userMsg: ChatMsg = { id: nextMsgId(), role: "user", content: text, timestamp: Date.now() };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(text, next), 0);
      return next;
    });
  }, [callBuilder]);

  const handleOptionSelect = useCallback((option: { id: string; label: string; description?: string }) => {
    const userMsg: ChatMsg = { id: nextMsgId(), role: "user", content: option.label, timestamp: Date.now() };

    if (option.id === "refine") {
      setMessages((prev) => [...prev, userMsg, {
        id: nextMsgId(),
        role: "assistant",
        content: "What would you like to change? You can say things like:\n- \"Change the philosophy to focus on growth\"\n- \"Increase risk to 7\"\n- \"Add a rule for ROE > 20%\"\n- \"Remove macro evaluation\"",
        timestamp: Date.now(),
      }]);
      return;
    }

    if (presetKeys.includes(option.id)) {
      setMessages((prev) => {
        const next = [...prev, userMsg];
        setTimeout(async () => {
          setIsProcessing(true);
          const stepTitles: { label: string; detail?: string }[] = [
            { label: `Loaded preset "${option.label}"` },
          ];
          if (documentTexts.length > 0) {
            stepTitles.push({
              label: `Extracted signals from ${documentTexts.length} document${documentTexts.length === 1 ? "" : "s"}`,
              detail: documentTexts.map((d) => d.filename).join(", "),
            });
          }
          stepTitles.push({ label: "Applied changes to your agent" });
          beginSteps(stepTitles);
          try {
            const [preset, signals] = await Promise.all([
              BuilderService.getPreset(option.id),
              documentTexts.length > 0 ? BuilderService.extractSignals(documentTexts) : null,
            ]);

            let merged = { ...preset };
            if (signals && signals.philosophy) {
              merged = {
                ...merged,
                persona: { philosophy_and_mindset: signals.philosophy || preset.persona.philosophy_and_mindset },
                configuration: {
                  investment_horizon: signals.horizon || preset.configuration.investment_horizon,
                  risk_appetite: signals.risk || preset.configuration.risk_appetite,
                },
              };
              if (signals.qualitative_params?.length) {
                merged.asset_evaluation = { ...merged.asset_evaluation, qualitative: signals.qualitative_params };
              }
              if (signals.quantitative_rules?.length) {
                merged.asset_evaluation = { ...merged.asset_evaluation, quantitative: signals.quantitative_rules };
              }
            }

            const prevDraft = proposalRef.current;
            const mergedDraft = { ...prevDraft, ...merged, name: merged.name || option.label };
            if (JSON.stringify(prevDraft) !== JSON.stringify(mergedDraft)) setProposal(mergedDraft);

            const summary = `I've set up a "${merged.name}" agent.\n\n` +
              `Philosophy: ${merged.persona.philosophy_and_mindset.slice(0, 150)}...\n\n` +
              `Configuration: ${merged.configuration.investment_horizon}, Risk ${merged.configuration.risk_appetite}/10\n\n` +
              `Asset Evaluation: ${merged.asset_evaluation.qualitative.length} qualitative, ${merged.asset_evaluation.quantitative.length} quantitative rules\n\n` +
              `Macro Evaluation: ${merged.macro_evaluation.qualitative.length} qualitative, ${merged.macro_evaluation.quantitative.length} quantitative rules\n\n` +
              `Looks good, or want to adjust something?`;

            setMessages((prev) => [...prev, {
              id: nextMsgId(),
              role: "assistant",
              content: summary,
              options: [
                { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
                { id: "more_docs", label: "Upload more documents", description: "Add additional documents to refine the agent" },
              ],
              timestamp: Date.now(),
            }]);
          } catch {
            setMessages((prev) => [...prev, {
              id: nextMsgId(),
              role: "assistant",
              content: "I've set up a basic agent. Describe what you'd like to change, or upload documents to refine it.",
              timestamp: Date.now(),
            }]);
          } finally {
            finalizeSteps();
            setIsProcessing(false);
          }
        }, 0);
        return next;
      });
      return;
    }

    // Custom path or more_docs — forward to LLM.
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(option.label, next), 0);
      return next;
    });
  }, [callBuilder, documentTexts, presetKeys, beginSteps, finalizeSteps]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    const newDocs: DocFile[] = files.map((f) => ({ filename: f.name, char_count: 0, status: "uploading" as const }));
    setDocuments((prev) => [...prev, ...newDocs]);

    try {
      const result = await BuilderService.uploadDocuments(files);

      setDocuments((prev) => {
        const updated = [...prev];
        result.documents.forEach((doc, i) => {
          const idx = updated.length - files.length + i;
          if (idx >= 0 && idx < updated.length) updated[idx] = { filename: doc.filename, char_count: doc.char_count, status: "processing" };
        });
        return updated;
      });

      const newDocTexts = result.documents.map((d) => ({ filename: d.filename, text: d.text }));
      setDocumentTexts((prev) => [...prev, ...newDocTexts]);

      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Processing ${result.documents.length} document(s): ${result.documents.map((d) => d.filename).join(", ")}...`,
        timestamp: Date.now(),
      }]);
      setIsProcessing(true);
      beginSteps([
        { label: `Extracted text from ${newDocTexts.length} document${newDocTexts.length === 1 ? "" : "s"}`, detail: newDocTexts.map((d) => d.filename).join(", ") },
        { label: "Extracted investment signals (style, criteria, risk)" },
        { label: "Applied changes to your agent" },
      ]);

      try {
        const signals = await BuilderService.extractSignals(newDocTexts);
        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((_, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) updated[idx] = { ...updated[idx], status: "done" };
          });
          return updated;
        });

        let summary = `From your document(s), I detected:\n`;
        if (signals.style && signals.style !== "custom") summary += `- Investment style: ${signals.style}\n`;
        if (signals.philosophy) summary += `- Philosophy: ${signals.philosophy.slice(0, 200)}${signals.philosophy.length > 200 ? "..." : ""}\n`;
        if (signals.horizon) summary += `- Horizon: ${signals.horizon}\n`;
        if (signals.risk) summary += `- Risk: ${signals.risk}/10\n`;
        if (signals.qualitative_params?.length) summary += `- ${signals.qualitative_params.length} qualitative parameters detected\n`;
        if (signals.quantitative_rules?.length) summary += `- ${signals.quantitative_rules.length} quantitative rules detected\n`;

        if (!signals.philosophy && !signals.qualitative_params?.length && !signals.quantitative_rules?.length) {
          setMessages((prev) => [...prev, {
            id: nextMsgId(),
            role: "assistant",
            content: `I received the document(s) but couldn't extract specific investment criteria. You can describe what you'd like me to pull from them, or ask me to build an agent based on their content.`,
            timestamp: Date.now(),
          }]);
        } else {
          setProposal((prev) => {
            const next = { ...prev };
            if (signals.philosophy) next.persona = { ...(next.persona as Record<string, unknown>), philosophy_and_mindset: signals.philosophy };
            if (signals.horizon || signals.risk) {
              next.configuration = {
                ...(next.configuration as Record<string, unknown>),
                investment_horizon: signals.horizon || (prev.configuration as Record<string, unknown>)?.investment_horizon || "",
                risk_appetite: signals.risk || (prev.configuration as Record<string, unknown>)?.risk_appetite || 5,
              };
            }
            if (signals.qualitative_params?.length) {
              next.asset_evaluation = { ...(next.asset_evaluation as Record<string, unknown>), qualitative: signals.qualitative_params };
            }
            if (signals.quantitative_rules?.length) {
              next.asset_evaluation = { ...(next.asset_evaluation as Record<string, unknown>), quantitative: signals.quantitative_rules };
            }
            return next;
          });

          setMessages((prev) => [...prev, {
            id: nextMsgId(),
            role: "assistant",
            content: summary + "\n\nI've applied these settings to your proposed draft. Review them in the preview, then apply the changes to your agent.",
            options: [
              { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
              { id: "more_docs", label: "Upload more documents", description: "Add additional documents to refine the agent" },
            ],
            timestamp: Date.now(),
          }]);
        }
      } catch {
        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((_, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) updated[idx] = { ...updated[idx], status: "done" };
          });
          return updated;
        });
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: "assistant",
          content: `Received ${result.documents.length} document(s): ${result.documents.map((d) => d.filename).join(", ")}. Describe what you'd like me to extract, or ask me to build an agent from their content.`,
          timestamp: Date.now(),
        }]);
      } finally {
        finalizeSteps();
        setIsProcessing(false);
      }
    } catch {
      setDocuments((prev) => {
        const updated = [...prev];
        for (let i = updated.length - files.length; i < updated.length; i++) {
          if (i >= 0) updated[i] = { ...updated[i], status: "error", error: "Upload failed" };
        }
        return updated;
      });
    }
  }, [beginSteps, finalizeSteps]);

  const handleRemoveDocument = useCallback((index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
    setDocumentTexts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const changes = useMemo(
    () => diffDraft(base, proposal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposal, agent],
  );

  const apply = () => {
    onApply(proposal);
    clearLocalDraft(persistKey);
    setMessages([]);
    setDocuments([]);
    setDocumentTexts([]);
    setTraces([]);
    setLiveSteps(null);
    turnCount.current = 0;
    toaster.create({ title: "Changes applied to your agent", type: "success" });
  };

  const discardAll = () => {
    setProposal(base);
    setMessages([]);
  };

  const discardChange = (c: ChangeItem) => {
    const p = c.path;
    if (!p) return;
    setProposal((prev) => setPath(prev, p, getPath(base, p)));
  };

  if (!open) return null;

  const preview = (
    <AgentPreviewPanel
      agentDraft={proposal}
      isDirty={changes.length > 0}
      changes={changes}
      onApplyChanges={apply}
      onClearChanges={discardAll}
      onDiscardChange={discardChange}
    />
  );

  const chat = (
    <>
      <AnimatePresence initial={false}>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24 }}
            style={{ padding: "12px 12px 0" }}
          >
            <AgentActivity
              title="Drafting your agent"
              subtitle={selectedModel ? `Model: ${selectedModel}` : "Researching and drafting your configuration"}
              streamUrl={`/builder/${sessionIdRef.current}/stream`}
              active={isProcessing}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Box flex={1} minH={0} display="flex" overflow="hidden">
        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          onOptionSelect={handleOptionSelect}
          onUploadFiles={handleUploadFiles}
          documents={documents}
          onRemoveDocument={handleRemoveDocument}
          isProcessing={isProcessing}
          steps={liveSteps}
          traces={traces}
        />
      </Box>
    </>
  );

  return (
    <motion.div
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "var(--surface-canvas)", display: "flex", flexDirection: "column" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      data-testid="draft-ai-panel"
    >
      {/* Header */}
      <Flex
        align="center"
        justify="space-between"
        px={{ base: 3, md: 6 }}
        py={2.5}
        borderBottom="1px solid var(--hairline)"
        bg="var(--surface-panel)"
        flexShrink={0}
        gap={2}
      >
        <Flex align="center" gap={2} minW={0}>
          <Box display="flex" flexShrink={0} color="var(--accent-primary)">
            <MdOutlineAutoAwesome size={18} />
          </Box>
          <Flex direction="column" minW={0}>
            <Text fontSize={type.section} fontWeight={600} color="var(--ink-primary)" truncate>
              Draft with AI
            </Text>
            <Text fontSize={type.micro} color="var(--ink-tertiary)" truncate display={{ base: "none", sm: "block" }}>
              Changes appear as a proposal you review and apply — they never overwrite your edits silently.
            </Text>
          </Flex>
        </Flex>

        <Flex align="center" gap={2} flexShrink={0}>
          {changes.length > 0 && (
            <Button
              size="sm"
              variant="surface"
              colorPalette="blue"
              minH={`${tap}px`}
              onClick={apply}
            >
              <MdCheck size={14} />
              Apply changes
            </Button>
          )}
          <Button
            variant="subtle"
            size="sm"
            minH={`${tap}px`}
            color="var(--ink-secondary)"
            onClick={onClose}
            aria-label="Close Draft with AI"
          >
            <MdClose size={18} />
          </Button>
        </Flex>
      </Flex>

      {/* Model selector */}
      {availableModels.length > 0 && (
        <Flex align="center" gap={2} px={{ base: 3, md: 6 }} py={2} borderBottom="1px solid var(--hairline)" flexShrink={0} flexWrap="wrap">
          <Text fontSize={type.micro} color="var(--ink-tertiary)" whiteSpace="nowrap">Model</Text>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{
              fontSize: type.meta,
              padding: "4px 24px 4px 8px",
              borderRadius: "3px",
              border: "1px solid var(--hairline)",
              background: "var(--surface-panel)",
              color: "var(--ink-primary)",
              cursor: "pointer",
              appearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 6px center",
              maxWidth: "100%",
              textOverflow: "ellipsis",
            }}
          >
            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {changes.length > 0 && (
            <Text fontSize={type.micro} color="var(--signal-caution)" as="span" whiteSpace="nowrap">
              {changes.length} proposed change{changes.length === 1 ? "" : "s"}
            </Text>
          )}
        </Flex>
      )}

      {/* Body */}
      <Flex flex={1} minH={0} overflow="hidden">
        {isMobile ? (
          <Tabs.Root
            value={tab}
            onValueChange={(e) => setTab(e.value as "chat" | "preview")}
            variant="line"
            w="full"
            display="flex"
            flexDirection="column"
          >
            <Tabs.List px={3} pt={1} gap={2}>
              <Tabs.Trigger value="chat" flex={1}>Chat</Tabs.Trigger>
              <Tabs.Trigger value="preview" flex={1}>Preview{changes.length ? ` (${changes.length})` : ""}</Tabs.Trigger>
              <Tabs.Indicator />
            </Tabs.List>
            <Tabs.Content value="chat" flex={1} minH={0} display="flex" flexDirection="column">
              {chat}
            </Tabs.Content>
            <Tabs.Content value="preview" flex={1} minH={0} overflowY="auto">
              <Box p={3} h="100%">
                <Box bg="var(--surface-panel)" border="1px solid var(--hairline)" borderRadius="8px" p={3} h="100%" overflow="hidden">
                  {preview}
                </Box>
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          <>
            <Flex direction="column" flex={1} minW={0} overflow="hidden">
              {chat}
            </Flex>
            <Box flex="0 0 42%" minW={0} p={4} overflow="hidden" display="flex">
              <Box flex={1} bg="var(--surface-panel)" border="1px solid var(--hairline)" borderRadius="8px" p={3} overflow="hidden">
                {preview}
              </Box>
            </Box>
          </>
        )}
      </Flex>
    </motion.div>
  );
}
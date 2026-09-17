import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Flex, Text, Button, Input } from "@chakra-ui/react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { BuilderService, AgentService, VoyagerService, AnalysisService, SettingsService } from "@/db";
import ChatPanel from "@/components/builder/ChatPanel";
import AgentPreviewPanel from "@/components/builder/AgentPreviewPanel";
import AgentActivity from "@/components/shared/AgentActivity";
import type { BuilderStep } from "@/components/builder/StepsTrace";
import type { ChatMsg } from "@/components/builder/ChatBubble";
import { MdSave, MdOutlineEdit, MdEdit, MdPreview, MdClose } from "react-icons/md";
import { diffDraft, type ChangeItem } from "@/lib/draftDiff";

const DEFAULT_AGENT = {
  name: "",
  persona: { philosophy_and_mindset: "" },
  configuration: { investment_horizon: "", risk_appetite: 5 },
  asset_evaluation: { qualitative: [], quantitative: [] },
  macro_evaluation: { qualitative: [], quantitative: [] },
};

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

export default function AgentBuilder() {
  const { id: urlAgentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  const passedDraft = (location.state as any)?.agentDraft;
  const passedIsDirty = (location.state as any)?.isDirty ?? false;

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [agentDraft, setAgentDraft] = useState<Record<string, unknown>>(passedDraft || { ...DEFAULT_AGENT });
  const [isDirty, setIsDirty] = useState(passedIsDirty);
  const [isProcessing, setIsProcessing] = useState(false);
  const [documents, setDocuments] = useState<DocFile[]>([]);
  const [documentTexts, setDocumentTexts] = useState<{ filename: string; text: string }[]>([]);
  const [metrics, setMetrics] = useState<{ id: string; name: string; type: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draftChanges, setDraftChanges] = useState<ChangeItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(urlAgentId || null);
  const [showPreview, setShowPreview] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const draftRef = useRef(agentDraft);
  draftRef.current = agentDraft;
  const processingRef = useRef(false);
  const savingRef = useRef(false);
  const [steps, setSteps] = useState<BuilderStep[] | null>(null);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `builder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const clearStepTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }, []);

  // Reveal the real pipeline as a spinner->tick trace. Final step stays active
  // (spinner) until the whole turn resolves; the others tick on a staggered timer.
  const beginSteps = useCallback((titles: { label: string; detail?: string }[]) => {
    clearStepTimers();
    const n = titles.length;
    setSteps(titles.map((t, i) => ({
      ...t,
      status: i === 0 || i === n - 1 ? ("active" as const) : ("pending" as const),
    })));
    titles.forEach((_, i) => {
      if (i >= n - 1) return;
      const idx = i;
      stepTimers.current.push(setTimeout(() => {
        setSteps((prev) => prev?.map((s, j) => (j <= idx ? { ...s, status: "done" as const } : s)) ?? prev);
      }, 200 + idx * 280));
    });
  }, [clearStepTimers]);

  const resolveSteps = useCallback((extra?: { label: string; detail?: string }) => {
    clearStepTimers();
    setSteps((prev) => {
      const base = (prev ?? []).map((s) => ({ ...s, status: "done" as const }));
      return extra ? [...base, { ...extra, status: "done" as const }] : base;
    });
  }, [clearStepTimers]);

  // Merge an incremental diff into the accumulated "since last save" list.
  // Same label = same field; the newest detail wins. Returns true if anything changed.
  const recordChanges = useCallback((prev: Record<string, unknown>, next: Record<string, unknown>): boolean => {
    const fresh = diffDraft(prev, next);
    if (!fresh.length) return false;
    setDraftChanges((old) => {
      const map = new Map(old.map((c) => [c.label, c] as const));
      for (const c of fresh) map.set(c.label, c);
      return [...map.values()];
    });
    return true;
  }, []);

  // Fetch metrics + available models + load existing agent on mount
  useEffect(() => {
    VoyagerService.getAvailableMetrics("NSE").then((data) => {
      if (data?.fields) setMetrics(data.fields);
    }).catch(() => {});

    Promise.all([
      AnalysisService.getAvailableModels(),
      SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
      AnalysisService.getDefaultModel().catch(() => ({ model_id: "" })),
    ]).then(([modelsData, settings, def]) => {
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
    }).catch(() => {});

    // If URL has an agent ID, load it into the builder
    if (urlAgentId) {
      if (passedDraft) {
        setAgentId(urlAgentId);
        setInitialized(true);
        setMessages([{
          id: nextMsgId(),
          role: "assistant",
          content: `Resumed editing "${passedDraft.name || "Untitled"}". What would you like to change?`,
          options: [
            { id: "save", label: "Looks good, save it", description: "Save the agent with these settings" },
            { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
          ],
          timestamp: Date.now(),
        }]);
      } else {
        AgentService.readAgent(urlAgentId).then((agent) => {
          setAgentDraft(agent);
          setAgentId(agent.id || agent._id);
          setInitialized(true);
          setMessages([{
            id: nextMsgId(),
            role: "assistant",
            content: `Loaded "${agent.name || "Untitled"}". What would you like to change?`,
            options: [
              { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
              { id: "more_docs", label: "Upload documents to refine", description: "Upload research docs to improve the agent" },
            ],
            timestamp: Date.now(),
          }]);
        }).catch(() => {
          setInitialized(true);
          setMessages([{
            id: nextMsgId(),
            role: "assistant",
            content: "Couldn't load that agent. Starting fresh.",
            timestamp: Date.now(),
          }]);
        });
      }
    }
  }, [urlAgentId]);

  const [presetKeys, setPresetKeys] = useState<string[]>([]);

  // Initial greeting from builder (only if not loading existing agent)
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    // Load preset keys in background for option card matching
    BuilderService.getPresets().then((presets) => {
      setPresetKeys(presets.map((p: { key: string }) => p.key));
    }).catch(() => {});
    setMessages([{
      id: nextMsgId(),
      role: "assistant",
      content: "What kind of investment agent are you building? Describe your investment style, philosophy, or the kind of investor you are — and I'll help you build it.",
      timestamp: Date.now(),
    }]);
  }, [initialized]);

  const callBuilder = useCallback(async (userResponse: string, messagesSnapshot: ChatMsg[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    try {
      // Validate model access first
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
        agent_draft: draftRef.current,
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

      const assistantMsg: ChatMsg = {
        id: nextMsgId(),
        role: "assistant",
        content: response.message,
        options: response.options,
        annotations: response.annotations,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (response.agent_draft_update) {
        const prev = draftRef.current;
        const update = response.agent_draft_update!;
        const next: Record<string, unknown> = { ...prev, ...update };
        const phil = (update.philosophy as string) || (update.persona as any)?.philosophy_and_mindset || (prev.persona as any)?.philosophy_and_mindset || (prev.philosophy as string);
        if (phil) {
          next.persona = { ...(prev.persona as any), ...(update.persona as any), philosophy_and_mindset: phil };
          next.philosophy = phil;
        }
        if (update.configuration) {
          next.configuration = { ...(prev.configuration as any), ...(update.configuration as any) };
        }
        // Deep-merge evaluation sections so a patch that touches only one
        // subsection (e.g. qualitative) can't silently wipe the other (quantitative).
        for (const key of ["asset_evaluation", "macro_evaluation"]) {
          if (update[key]) {
            next[key] = { ...(prev[key] as any), ...(update[key] as any) };
          }
        }
        // A turn that didn't actually change the draft (e.g. a plain question)
        // must not mark it dirty.
        const changed = Object.keys(update).some((k) => JSON.stringify(update[k]) !== JSON.stringify(prev[k]));
        if (changed) {
          setAgentDraft(next);
          recordChanges(prev, next);
          setIsDirty(true);
        }
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
      resolveSteps(searched);
      setIsProcessing(false);
    }
  }, [metrics, documentTexts, selectedModel, beginSteps, resolveSteps, recordChanges]);

  const handleSendMessage = useCallback((text: string) => {
    const userMsg: ChatMsg = {
      id: nextMsgId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(text, next), 0);
      return next;
    });
  }, [callBuilder]);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    if (!agentDraft.name?.trim()) {
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: "Give your agent a name before saving. What should it be called?",
        timestamp: Date.now(),
      }]);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      if (agentId) {
        await AgentService.updateAgent({ ...agentDraft, id: agentId, _id: agentId });
      } else {
        const created = await AgentService.createAgent(agentDraft);
        const newId = created.id || created._id;
        setAgentId(newId);
        navigate(`/agent/builder/${newId}`, { replace: true, state: { agentDraft } });
      }
      setIsDirty(false);
      setDraftChanges([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Builder save]", msg);
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Failed to save: ${msg.slice(0, 150)}. Please try again.`,
        timestamp: Date.now(),
      }]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [agentDraft, agentId, navigate]);

  const handleOptionSelect = useCallback((option: { id: string; label: string; description?: string }) => {
    const userMsg: ChatMsg = {
      id: nextMsgId(),
      role: "user",
      content: option.label,
      timestamp: Date.now(),
    };

    // "save" option from conversation
    if (option.id === "save") {
      setMessages((prev) => [...prev, userMsg]);
      setTimeout(() => handleSave(), 0);
      return;
    }

    // "refine" option
    if (option.id === "refine") {
      setMessages((prev) => [...prev, userMsg, {
        id: nextMsgId(),
        role: "assistant",
        content: "What would you like to change? You can say things like:\n- \"Change the philosophy to focus on growth\"\n- \"Increase risk to 7\"\n- \"Add a rule for ROE > 20%\"\n- \"Remove macro evaluation\"",
        timestamp: Date.now(),
      }]);
      return;
    }

    // If it's a preset, fetch and apply it
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
                merged.asset_evaluation = {
                  ...merged.asset_evaluation,
                  qualitative: signals.qualitative_params,
                };
              }
              if (signals.quantitative_rules?.length) {
                merged.asset_evaluation = {
                  ...merged.asset_evaluation,
                  quantitative: signals.quantitative_rules,
                };
              }
            }

            const prevDraft = draftRef.current;
            const mergedDraft = { ...prevDraft, ...merged, name: merged.name || option.label };
            if (recordChanges(prevDraft, mergedDraft)) {
              setAgentDraft(mergedDraft);
              setIsDirty(true);
            }

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
                { id: "save", label: "Looks good, save it", description: "Save the agent with these settings" },
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
            resolveSteps();
            setIsProcessing(false);
          }
        }, 0);
        return next;
      });
      return;
    }

    // Custom path or more_docs — forward to LLM
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(option.label, next), 0);
      return next;
    });
  }, [callBuilder, documentTexts, handleSave, presetKeys]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    const newDocs: DocFile[] = files.map((f) => ({
      filename: f.name,
      char_count: 0,
      status: "uploading" as const,
    }));
    setDocuments((prev) => [...prev, ...newDocs]);

    try {
      const result = await BuilderService.uploadDocuments(files);

      setDocuments((prev) => {
        const updated = [...prev];
        result.documents.forEach((doc, i) => {
          const idx = updated.length - files.length + i;
          if (idx >= 0 && idx < updated.length) {
            updated[idx] = { filename: doc.filename, char_count: doc.char_count, status: "processing" };
          }
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
        {
          label: `Extracted text from ${newDocTexts.length} document${newDocTexts.length === 1 ? "" : "s"}`,
          detail: newDocTexts.map((d) => d.filename).join(", "),
        },
        { label: "Extracted investment signals (style, criteria, risk)" },
        { label: "Applied changes to your agent" },
      ]);

      try {
        const signals = await BuilderService.extractSignals(newDocTexts);

        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((doc, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) {
              updated[idx] = { ...updated[idx], status: "done" };
            }
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
          setAgentDraft((prev) => {
            const next = { ...prev };
            if (signals.philosophy) {
              next.persona = { ...(next.persona as Record<string, unknown>), philosophy_and_mindset: signals.philosophy };
            }
            if (signals.horizon || signals.risk) {
              next.configuration = {
                ...(next.configuration as Record<string, unknown>),
                investment_horizon: signals.horizon || (prev.configuration as Record<string, unknown>)?.investment_horizon || "",
                risk_appetite: signals.risk || (prev.configuration as Record<string, unknown>)?.risk_appetite || 5,
              };
            }
            if (signals.qualitative_params?.length) {
              next.asset_evaluation = {
                ...(next.asset_evaluation as Record<string, unknown>),
                qualitative: signals.qualitative_params,
              };
            }
            if (signals.quantitative_rules?.length) {
              next.asset_evaluation = {
                ...(next.asset_evaluation as Record<string, unknown>),
                quantitative: signals.quantitative_rules,
              };
            }
            return next;
          });
          setIsDirty(true);

          setMessages((prev) => [...prev, {
            id: nextMsgId(),
            role: "assistant",
            content: summary + "\n\nI've applied these settings to your agent. Want to adjust anything?",
            options: [
              { id: "save", label: "Looks good, save it", description: "Save the agent with these settings" },
              { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
              { id: "more_docs", label: "Upload more documents", description: "Add additional documents to refine the agent" },
            ],
            timestamp: Date.now(),
          }]);
        }
      } catch {
        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((doc, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) {
              updated[idx] = { ...updated[idx], status: "done" };
            }
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
        resolveSteps();
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
  }, [beginSteps, resolveSteps]);

  const handleRemoveDocument = useCallback((index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
    setDocumentTexts((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  }, []);

  const handleOpenManual = useCallback(() => {
    if (agentId) {
      navigate(`/agent/${agentId}`, { state: { agentDraft, isDirty } });
    } else {
      navigate("/agent/new", { state: { agentDraft, isDirty } });
    }
  }, [agentId, agentDraft, isDirty, navigate]);

  return (
    <Box bg="var(--surface-canvas)" h="100%" overflow="hidden" display="flex" flexDirection="column">
      {/* Header */}
      <Flex
        align="center"
        justify="space-between"
        px={{ base: 4, md: 8 }}
        py={3}
        borderBottom="1px solid var(--hairline)"
        bg="var(--surface-panel)"
        flexShrink={0}
        gap={{ base: 2, md: 4 }}
        flexWrap={{ base: "wrap", md: "nowrap" }}
      >
        <Flex
          align={{ base: "stretch", md: "center" }}
          gap={{ base: 1.5, md: 4 }}
          minW={0}
          flex={{ base: "1 1 auto", md: "0 1 auto" }}
          direction={{ base: "column", md: "row" }}
          w={{ base: "100%", md: "auto" }}
        >
          <Flex direction={{ base: "row", md: "column" }} align={{ base: "center", md: "flex-start" }} justify="space-between" minW={0} w={{ base: "100%", md: "auto" }} maxW={{ base: "none", md: "300px" }} flexShrink={1}>
            <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)" whiteSpace="nowrap">
              Agent Builder
            </Text>
            <Text fontSize="11px" color="var(--ink-tertiary)" whiteSpace="nowrap" display={{ base: "none", md: "block" }} truncate>
              Use our Agent Builder to create your research agent — configured to your needs
            </Text>
          </Flex>
          <Box position="relative" w={{ base: "100%", md: "240px" }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15, duration: dur.base, ease }}
              style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", zIndex: 1, pointerEvents: "none" }}
            >
              <MdEdit size={13} color="var(--ink-tertiary)" />
            </motion.div>
            <Input
              value={(agentDraft.name as string) || ""}
              onChange={(e) => {
                const nextName = e.target.value;
                const prev = draftRef.current;
                setAgentDraft((d) => ({ ...d, name: nextName }));
                recordChanges(prev, { ...prev, name: nextName });
                setIsDirty(true);
              }}
              placeholder="Agent name..."
              size="sm"
              w="full"
              pl={8}
              bg="var(--surface-recessed)"
              border="1px solid var(--hairline)"
              borderRadius="3px"
              fontSize="13px"
              fontWeight={500}
              _placeholder={{ color: "var(--ink-tertiary)" }}
              _focus={{ borderColor: "var(--accent-primary)", outline: "none" }}
            />
          </Box>
        </Flex>

        <Flex align="center" gap={2.5} flexShrink={0} w={{ base: "100%", md: "auto" }} flexWrap="wrap" justify={{ base: "flex-start", md: "flex-end" }}>
          {/* Model selector */}
          {availableModels.length > 0 && (
            <Flex align="center" gap={1.5}>
          <Text fontSize="11px" color="var(--ink-tertiary)" whiteSpace="nowrap" display={{ base: "none", md: "inline" }}>Model</Text>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  fontSize: "12px",
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
                  maxWidth: "150px",
                }}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Flex>
          )}

          <AnimatePresence mode="wait">
            {isDirty ? (
              <Flex as={motion.div} key="dirty" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5}>
                <motion.span
                  animate={{ scale: [1, 1.25, 1] }}
                  transition={{ repeat: Infinity, repeatDelay: 1.6, duration: dur.slow }}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--signal-caution)", display: "inline-block" }}
                />
                <Text as="span" fontSize="12px" color="var(--signal-caution)" fontWeight={500} display={{ base: "none", md: "inline" }}>
                  Unsaved
                </Text>
              </Flex>
            ) : saved ? (
              <Flex as={motion.div} key="saved" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5}>
                <Box w="7px" h="7px" borderRadius="50%" bg="var(--signal-positive)" />
                <Text as="span" fontSize="12px" color="var(--ink-tertiary)" display={{ base: "none", md: "inline" }}>
                  Saved
                </Text>
              </Flex>
            ) : null}
          </AnimatePresence>

          <Button
            as={motion.button}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            size="xs"
            variant="subtle"
            color="var(--ink-secondary)"
            display={{ base: "inline-flex", lg: "none" }}
            onClick={() => setShowPreview((p) => !p)}
            aria-label="Toggle preview"
            fontSize="12px"
          >
            <MdPreview size={14} color="var(--accent-primary)" />
            Preview
          </Button>

          <Button
            as={motion.button}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            size="xs"
            variant="subtle"
            color="var(--ink-secondary)"
            onClick={handleOpenManual}
            fontSize="12px"
          >
            <MdOutlineEdit size={13} color="var(--accent-primary)" />
            Manual Editor
          </Button>

          <Button
            as={motion.button}
            animate={isDirty ? {
              boxShadow: [
                "0 0 0 0 rgba(91, 127, 222, 0)",
                "0 0 0 4px rgba(91, 127, 222, 0.3)",
                "0 0 0 0 rgba(91, 127, 222, 0)",
              ],
            } : { boxShadow: "0 0 0 0 rgba(91, 127, 222, 0)" }}
            transition={isDirty ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
            whileTap={{ scale: 0.97 }}
            size="sm"
            variant="surface"
            colorPalette="blue"
            px={5}
            _hover={{ opacity: 0.92 }}
            borderRadius="3px"
            loading={saving}
            onClick={handleSave}
          >
            <MdSave size={14} />
            {agentId ? "Save" : "Create Agent"}
          </Button>
        </Flex>
      </Flex>

      {/* Two-column layout */}
      <Flex flex={1} overflow="hidden" px={{ base: 0, md: 0 }} position="relative">
        {/* Chat panel — full width; preview opens as an overlay */}
        <Flex direction="column" h="100%" flex={1} overflow="hidden" minW={0}>
          <AnimatePresence initial={false}>
            {isProcessing && (
              <Box px={3} pt={3} as={motion.div} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: dur.base, ease }}>
                <AgentActivity
                  title="Building your agent"
                  subtitle={selectedModel ? `Model: ${selectedModel}` : "Researching and drafting your configuration"}
                  streamUrl={`/builder/${sessionIdRef.current}/stream`}
                  active={isProcessing}
                />
              </Box>
            )}
          </AnimatePresence>
          <Box flex={1} minH={0} display="flex">
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onOptionSelect={handleOptionSelect}
              onUploadFiles={handleUploadFiles}
              documents={documents}
              onRemoveDocument={handleRemoveDocument}
              isProcessing={isProcessing}
              steps={steps}
            />
          </Box>
        </Flex>

        {/* Preview panel — desktop */}
        <Box
          display={{ base: "none", lg: "flex" }}
          as={motion.div}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: dur.base, ease }}
          flex="0 0 60%"
          p={4}
          borderLeft="1px solid var(--hairline)"
          overflow="hidden"
        >
          <Box
            flex={1}
            minW={0}
            bg="var(--surface-panel)"
            border="1px solid var(--hairline)"
            borderRadius="8px"
            p={2}
            overflow="hidden"
          >
            <AgentPreviewPanel agentDraft={agentDraft} isDirty={isDirty} changes={draftChanges} />
          </Box>
        </Box>

        {/* Preview panel — mobile overlay */}
        <AnimatePresence>
          {showPreview && (
            <Box
              as={motion.div}
              position="fixed"
              inset={0}
              zIndex={1500}
              bg="var(--surface-panel)"
              display={{ lg: "none" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: dur.base, ease }}
            >
              <Flex align="center" justify="space-between" px={4} py={3} borderBottom="1px solid var(--hairline)">
                <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)">
                  Agent Preview
                </Text>
                <Button
                  as={motion.button}
                  whileTap={{ scale: 0.95 }}
                  size="sm"
                  variant="subtle"
                  color="var(--ink-secondary)"
                  onClick={() => setShowPreview(false)}
                  aria-label="Close preview"
                >
                  <MdClose size={18} />
                </Button>
              </Flex>
              <Box p={2} overflowY="auto" h="calc(100% - 49px)">
                <Box bg="var(--surface-panel)" border="1px solid var(--hairline)" borderRadius="8px" p={2} overflow="hidden">
                  <AgentPreviewPanel agentDraft={agentDraft} isDirty={isDirty} changes={draftChanges} />
                </Box>
              </Box>
            </Box>
          )}
        </AnimatePresence>
      </Flex>
    </Box>
  );
}

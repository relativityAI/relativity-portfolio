import { useState } from "react"
import ListEditor from "./shared/ListEditor"
import { VoyagerService } from "@/db"
import { toaster } from "@/components/ui/toaster"

interface AgentDataQualitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics?: any;
    persona?: string;
    section?: "asset_evaluation" | "macro_evaluation";
}

export default function AgentDataQualitative(props: AgentDataQualitativeProps) {
    const [drafting, setDrafting] = useState(false)
    const items = (props.data || []).map((p: any) => ({
        id: p.id || String(Math.random()),
        label: p.parameter,
        content: p.content,
        weightage: p.weightage,
    }))

    const handleChange = (newItems: any[]) => {
        const mapped = newItems.map((item: any) => ({
            id: item.id,
            parameter: item.label || "",
            content: item.content || "",
            weightage: item.weightage ?? 5,
        }))
        props.onUpdate(mapped)
    }

    const handleDraft = async () => {
        setDrafting(true)
        try {
            const res = await VoyagerService.draftParameters({
                persona: props.persona || "",
                section: props.section || "asset_evaluation",
            })
            const drafted = (res.parameters || []).map((p, i) => ({
                id: `${Date.now()}_${i}`,
                label: p.parameter,
                content: p.content || "",
                weightage: p.weightage ?? 5,
            }))
            handleChange([...items, ...drafted])
        } catch (e: any) {
            toaster.create({
                title: "Could not draft parameters",
                description: e?.response?.data?.error || "Please try again.",
                type: "error",
            })
        } finally {
            setDrafting(false)
        }
    }

    return (
        <ListEditor
            items={items}
            onChange={handleChange}
            showWeight={true}
            showLabel={true}
            labelPlaceholder="e.g. Management Quality"
            contentPlaceholder="Describe the parameter or add context..."
            emptyStateTitle="No qualitative parameters yet"
            emptyStateSubtitle="Add them manually or let AI draft a starting list from your persona."
            addButtonLabel="ADD PARAMETER"
            onDraft={handleDraft}
            drafting={drafting}
            draftDisabled={!props.persona}
            draftHint="Set your persona philosophy first — AI drafting uses it to add compatible parameters."
        />
    )
}

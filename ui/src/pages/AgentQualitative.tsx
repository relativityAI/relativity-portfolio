import ListEditor from "./shared/ListEditor"

interface AgentDataQualitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics?: any;
}

export default function AgentDataQualitative(props: AgentDataQualitativeProps) {
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

    return (
        <ListEditor
            items={items}
            onChange={handleChange}
            showWeight={true}
            showLabel={true}
            labelPlaceholder="e.g. Management Quality"
            contentPlaceholder="Describe the parameter or add context..."
            emptyStateTitle="No qualitative parameters yet"
            emptyStateSubtitle="Add parameters like management quality, brand strength, etc."
            addButtonLabel="ADD PARAMETER"
        />
    )
}

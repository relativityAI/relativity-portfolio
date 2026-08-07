import AgentDataQualitative from "../AgentQualitative"
import AgentQuantitative from "../AgentQuantitative"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

interface MacroEvalSectionProps {
    qualitative: any[];
    onQualitativeUpdate: (data: any[]) => void;
    quantitative: any[];
    onQuantitativeUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
}

export default function MacroEvalSection({
    qualitative,
    onQualitativeUpdate,
    quantitative,
    onQuantitativeUpdate,
    id,
    name,
    metrics,
    source,
}: MacroEvalSectionProps) {
    return (
        <>
            <SectionHeader
                title="Macro Evaluation"
                description="Reads the wider environment a stock operates in, at the market or sector level."
                sequenceNumber={4}
            />
            <SectionBlock
                sectionId="macro_evaluation"
                subsectionId="qualitative"
                title="Qualitative"
                description="Text-based judgment calls on macro conditions and their implications."
            >
                <AgentDataQualitative
                    name={name}
                    data={qualitative}
                    id={id}
                    metrics={metrics}
                    onUpdate={onQualitativeUpdate}
                />
            </SectionBlock>

            <SectionBlock
                sectionId="macro_evaluation"
                subsectionId="quantitative"
                title="Quantitative"
                description="Metric-driven quantitative criteria at the macro level."
            >
                <AgentQuantitative
                    name={name}
                    data={quantitative}
                    id={id}
                    metrics={metrics}
                    source={source}
                    onUpdate={onQuantitativeUpdate}
                />
            </SectionBlock>
        </>
    )
}

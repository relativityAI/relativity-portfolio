import AgentDataQualitative from "../AgentQualitative"
import AgentQuantitative from "../AgentQuantitative"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

interface AssetEvalSectionProps {
    qualitative: any[];
    onQualitativeUpdate: (data: any[]) => void;
    quantitative: any[];
    onQuantitativeUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
}

export default function AssetEvalSection({
    qualitative,
    onQualitativeUpdate,
    quantitative,
    onQuantitativeUpdate,
    id,
    name,
    metrics,
    source,
}: AssetEvalSectionProps) {
    return (
        <>
            <SectionHeader
                title="Asset Evaluation"
                description="The complete toolkit for judging any single stock on its own merits."
                sequenceNumber={3}
            />
            <SectionBlock
                sectionId="asset_evaluation"
                subsectionId="qualitative"
                title="Qualitative"
                description="Text-based judgment calls on a company's quality that can't be reduced to a number."
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
                sectionId="asset_evaluation"
                subsectionId="quantitative"
                title="Quantitative"
                description="Metric-driven quantitative criteria."
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

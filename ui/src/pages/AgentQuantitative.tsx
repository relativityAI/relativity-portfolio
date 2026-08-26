import { useState, useEffect } from "react"
import CriteriaBuilder from "./shared/CriteriaBuilder"

interface AgentQuantitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
}

export default function AgentQuantitative(props: AgentQuantitativeProps) {
    const [criteria, setCriteria] = useState<any[]>(props.data || []);

    useEffect(() => {
        setCriteria(props.data || []);
    }, [props.data]);

    const handleChange = (newCriteria: any[]) => {
        setCriteria(newCriteria);
        props.onUpdate(newCriteria);
    };

    return (
        <CriteriaBuilder
            criteria={criteria}
            onChange={handleChange}
            metrics={props.metrics}
            showWeight={true}
            emptyStateTitle="No criteria yet"
            emptyStateSubtitle="Add numerical conditions to filter stocks"
        />
    );
}

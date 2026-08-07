import { useState, useEffect } from "react"
import {
    Flex,
    Text,
} from "@chakra-ui/react"
import CriteriaBuilder from "./shared/CriteriaBuilder"

interface AgentQuantitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
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

    if (!props.source) {
        return (
            <Flex direction="column" align="center" gap={2} py={10} border="1px solid" borderColor="border" rounded="sm">
                <Text fontSize="sm" color="fg.muted">Select a data source above to configure criteria</Text>
            </Flex>
        );
    }

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

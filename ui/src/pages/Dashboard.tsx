import {
    Text,
    SimpleGrid,
    Flex
} from "@chakra-ui/react"
import RelCard from "@/components/RelCard"

// Show a little tutorial steps on the homepage

import { FaFilePen, FaDatabase, FaBrain, FaListCheck } from "react-icons/fa6";


// 1. select a market
// 2. create a profile
// 3. screen and select industries
// 4. screen and select stocks


export default function Dashboard() {

    const logoSize = 80;

    return (
        <Flex direction={"column"} gap={5}>

            <Text
                textStyle={"5xl"}
                fontWeight="semibold"
            >
                Dashboard
            </Text>

            <SimpleGrid
                columns={3}
                gap={10}
            >

                <RelCard
                    title="Investor Profiles"
                    to="/profiles"
                    description="View or create a new investor profile"
                    button="View / Create"
                    icon = {<FaFilePen size={logoSize} />}
                />
                <RelCard
                    title="Data Source"
                    to="/data-sources"
                    description="Manage data sources and available metrics"
                    button = "Manage"
                    icon = {<FaDatabase size={logoSize} />}

                />
                <RelCard
                    title="Run Analysis"
                    to="/analysis-list"
                    description="Analyze shares on existing profiles"
                    button = "Analyse"
                    icon = {<FaBrain size={logoSize} />}

                />
                <RelCard
                    title="Screen Shares"
                    to="/"
                    description="Screen multiple shares on an investor profile"
                    button = "Screen"
                    icon = {<FaListCheck size={logoSize} />}

                />

            </SimpleGrid>


        </Flex>
    )
}



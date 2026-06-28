import SearchBar from "@/components/SearchBar";
import {
    Badge, Button, Flex, Text, Spinner, Box, Select, Checkbox,
    createListCollection, Portal, HStack, VStack, Input, Table,
    Separator, SimpleGrid, Kbd
} from "@chakra-ui/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
    MdOutlineRefresh, MdOutlineStorage, MdKeyboardArrowDown,
    MdCheckCircle, MdErrorOutline, MdHistory, MdOutlineCloudDone,
    MdCalendarToday, MdAssessment
} from "react-icons/md";
import { useSearchParams } from "react-router-dom";
import { VoyagerService, NEBULA_BASE } from "@/db";

const sourceOptions = createListCollection({
    items: [
        { label: "SEC (US Market)", value: "SEC" },
        { label: "NSE (Indian Market)", value: "NSE" },
    ],
    itemToString: (item: any) => item.label,
    itemToValue: (item: any) => item.value,
});

const sourceKeyMap: Record<string, { mainKey: string; secondaryKey: string }> = {
    SEC: { mainKey: "ticker", secondaryKey: "name" },
    NSE: { mainKey: "SYMBOL", secondaryKey: "NAME" },
};

function formatCell(val: any): string {
    if (val == null) return "-";
    if (typeof val === "boolean") return String(val);
    if (typeof val === "object") {
        try { return JSON.stringify(val); } catch { return String(val); }
    }
    return String(val);
}

const ROW_LIMIT = 100;

function isFinancialsData(records: any[]): boolean {
    if (!records || records.length === 0) return false;
    const first = records[0];
    const keys = Object.keys(first);
    if (keys.includes("date") && keys.includes("financials")) {
        const fin = first.financials;
        if (Array.isArray(fin) && fin.length > 0) {
            return Object.keys(fin[0]).includes("tag") && Object.keys(fin[0]).includes("value");
        }
    }
    return false;
}

function FinancialsTable({ records }: { records: any[] }) {
    const dates = useMemo(() => {
        return records.map(r => r.date).filter(Boolean).sort();
    }, [records]);

    const rows = useMemo(() => {
        const tagMap = new Map<string, { tag: string; values: Record<string, string> }>();
        records.forEach(period => {
            const date = period.date;
            const fin = Array.isArray(period.financials) ? period.financials : [];
            fin.forEach((f: any) => {
                const tag = f.tag;
                if (!tagMap.has(tag)) tagMap.set(tag, { tag, values: {} });
                if (date) {
                    tagMap.get(tag)!.values[date] = formatCell(f.value);
                }
            });
        });
        return Array.from(tagMap.values());
    }, [records]);

    const allCols = ["tag", ...dates];

    return (
        <Box overflowX="auto" maxH="480px" overflowY="auto">
            <Table.Root size="xs" variant="line">
                <Table.Header>
                    <Table.Row>
                        {allCols.map(col => (
                            <Table.ColumnHeader
                                key={col}
                                color="fg.subtle"
                                fontSize="10px"
                                py={2}
                                whiteSpace="nowrap"
                                position={col === "tag" ? "sticky" : undefined}
                                left={col === "tag" ? 0 : undefined}
                                bg="bg.muted"
                                zIndex={col === "tag" ? 1 : undefined}
                                minW={col === "tag" ? "180px" : "110px"}
                            >
                                {col === "tag" ? "Metric" : col}
                            </Table.ColumnHeader>
                        ))}
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {rows.length === 0 ? (
                        <Table.Row>
                            <Table.Cell colSpan={allCols.length} textAlign="center" color="fg.muted" py={6}>
                                No financial data
                            </Table.Cell>
                        </Table.Row>
                    ) : (
                        rows.map((row, i) => (
                            <Table.Row key={row.tag} _hover={{ bg: "bg.muted" }}>
                                <Table.Cell
                                    fontSize="10px"
                                    fontWeight="medium"
                                    color="fg"
                                    position="sticky"
                                    left={0}
                                    bg="bg"
                                    minW="180px"
                                    maxW="220px"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    whiteSpace="nowrap"
                                >
                                    {row.tag}
                                </Table.Cell>
                                {dates.map(d => (
                                    <Table.Cell key={d} fontSize="10px" color="fg.muted" minW="110px">
                                        {row.values[d] ?? "-"}
                                    </Table.Cell>
                                ))}
                            </Table.Row>
                        ))
                    )}
                </Table.Body>
            </Table.Root>
        </Box>
    );
}

function DataTableSection({ title, records }: { title: string; records: any[] }) {
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState(true);
    const [showAll, setShowAll] = useState(false);

    const financials = isFinancialsData(records);

    const filtered = useMemo(() => {
        if (!search.trim()) return records;
        const q = search.toLowerCase();
        return records.filter(r =>
            Object.values(r).some(v =>
                v != null && String(v).toLowerCase().includes(q)
            )
        );
    }, [records, search]);

    const columns = useMemo(() => {
        if (financials || records.length === 0) return [];
        const skip = new Set(["_id", "_content_hash", "pulled_at"]);
        return Object.keys(records[0]).filter(k => !skip.has(k));
    }, [records, financials]);

    const displayed = showAll ? filtered : filtered.slice(0, ROW_LIMIT);

    if (!records || records.length === 0) return null;

    return (
        <Box border="1px solid" borderColor="border" rounded="md" overflow="hidden">
            <Flex
                justify="space-between"
                align="center"
                p={3}
                bg="bg.muted"
                cursor="pointer"
                onClick={() => setExpanded(!expanded)}
                userSelect="none"
            >
                <HStack gap={2}>
                    <Text fontSize="sm" fontWeight="semibold">{title}</Text>
                    <Badge size="xs" variant="surface" colorPalette="gray" color="fg.muted">{records.length}</Badge>
                    {search && (
                        <Badge size="xs" variant="surface" colorPalette="blue" color="blue.300">
                            {filtered.length} matched
                        </Badge>
                    )}
                </HStack>
                <Box transform={expanded ? "rotate(180deg)" : ""} transition="transform 0.2s">
                    <MdKeyboardArrowDown size={18} />
                </Box>
            </Flex>
            {expanded && (
                <Box p={3} borderTop="1px solid" borderColor="border">
                    <Input
                        placeholder={`Search ${title.toLowerCase().replace(/-/g, " ")}...`}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        mb={3}
                        size="sm"
                        variant="subtle"
                    />
                    {financials ? (
                        <FinancialsTable records={records} />
                    ) : (
                        <Box overflowX="auto" maxH="480px" overflowY="auto">
                            <Table.Root size="xs" variant="line">
                                <Table.Header>
                                    <Table.Row>
                                        {columns.map(col => (
                                            <Table.ColumnHeader key={col} color="fg.subtle" fontSize="10px" py={2} whiteSpace="nowrap">
                                                {col}
                                            </Table.ColumnHeader>
                                        ))}
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {displayed.length === 0 ? (
                                        <Table.Row>
                                            <Table.Cell colSpan={columns.length} textAlign="center" color="fg.muted" py={6}>
                                                No matching records
                                            </Table.Cell>
                                        </Table.Row>
                                    ) : (
                                        displayed.map((record, i) => (
                                            <Table.Row key={i} _hover={{ bg: "bg.muted" }}>
                                                {columns.map(col => (
                                                    <Table.Cell key={col} fontSize="10px" color="fg.muted" maxW="220px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                                        {formatCell(record[col])}
                                                    </Table.Cell>
                                                ))}
                                            </Table.Row>
                                        ))
                                    )}
                                </Table.Body>
                            </Table.Root>
                        </Box>
                    )}
                    {!financials && filtered.length > ROW_LIMIT && (
                        <Flex justify="center" mt={2}>
                            <Button size="xs" variant="ghost" onClick={() => setShowAll(!showAll)}>
                                {showAll
                                    ? `Show fewer (${ROW_LIMIT})`
                                    : `Show all ${filtered.length} records`
                                }
                            </Button>
                        </Flex>
                    )}
                </Box>
            )}
        </Box>
    );
}

export default function ManageData() {
    const [searchParams] = useSearchParams();

    const sourceFromUrl = searchParams.get("source") || "NSE";
    const symbolFromUrl = searchParams.get("symbol") || "";

    const [source, setSource] = useState(sourceFromUrl);
    const [symbol, setSymbol] = useState(symbolFromUrl);
    const [name, setName] = useState("");
    const [status, setStatus] = useState<any>(null);
    const [stockData, setStockData] = useState<any>(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [dataLoading, setDataLoading] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pullComplete, setPullComplete] = useState(false);
    const [statusNotFound, setStatusNotFound] = useState(false);
    const [ratiosData, setRatiosData] = useState<any>(null);
    const [ratiosLoading, setRatiosLoading] = useState(false);
    const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
    const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
    const [limit, setLimit] = useState<number>(0);
    const [statusAvailableMetrics, setStatusAvailableMetrics] = useState<Record<string, string[]> | null>(null);
    const [statusMetricsCatalog, setStatusMetricsCatalog] = useState<any[] | null>(null);

    const collectionOptions = useMemo(() => {
        if (!status?.record_counts) return [];
        return Object.keys(status.record_counts);
    }, [status]);

    const allMetricTags = useMemo(() => {
        if (!statusAvailableMetrics) return [];
        const tags = new Set<string>();
        selectedCollections.forEach(col => {
            const metrics = statusAvailableMetrics[col];
            if (metrics) metrics.forEach(m => tags.add(m));
        });
        return Array.from(tags).sort();
    }, [statusAvailableMetrics, selectedCollections]);

    useEffect(() => {
        if (collectionOptions.length > 0) {
            setSelectedCollections(collectionOptions);
        }
    }, [collectionOptions]);

    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const lastSeenSymbol = useRef("");

    const sourceKeys = useMemo(() => sourceKeyMap[source] || sourceKeyMap.SEC, [source]);

    const fetchStatus = useCallback(async () => {
        const sym = symbolRef.current;
        const src = sourceRef.current;
        if (!sym || !src) return;
        setStatusLoading(true);
        setStatusNotFound(false);
        try {
            const result = await VoyagerService.getStockDataStatus(sym, src);
            if (sym !== symbolRef.current || src !== sourceRef.current) return;
            if (result && result.detail) {
                setStatusNotFound(true);
                setStatus(null);
            } else if (result && result.symbol) {
                setStatus(result);
                setStatusAvailableMetrics(result.available_metrics || null);
                setStatusMetricsCatalog(result.metrics_catalog || null);
                setStatusNotFound(false);
            } else {
                setStatus(null);
                setStatusNotFound(false);
            }
        } catch {
            if (symbolRef.current !== sym || sourceRef.current !== src) return;
            setStatus(null);
            setStatusNotFound(true);
        } finally {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setStatusLoading(false);
            }
        }
    }, []);

    const fetchData = useCallback(async () => {
        const sym = symbolRef.current;
        const src = sourceRef.current;
        if (!sym || !src) return;
        setDataLoading(true);
        try {
            const result = await VoyagerService.getStockData(
                sym, src,
                selectedCollections.length > 0 ? selectedCollections : undefined,
                selectedMetrics.length > 0 ? selectedMetrics : undefined,
                limit > 0 ? limit : undefined
            );
            if (sym !== symbolRef.current || src !== sourceRef.current) return;
            const hasCategories = result && result.data && typeof result.data === "object";
            setStockData(hasCategories ? result : null);
        } catch {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setStockData(null);
            }
        } finally {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setDataLoading(false);
            }
        }
    }, [selectedCollections, selectedMetrics, limit]);

    const pullData = useCallback(async () => {
        const sym = symbolRef.current;
        const src = sourceRef.current;
        if (!sym || !src) return;
        setPulling(true);
        setPullComplete(false);
        try {
            await VoyagerService.pullStockData(sym, src);
            if (sym !== symbolRef.current || src !== sourceRef.current) return;
            await fetchStatus();
            setPullComplete(true);
        } catch {
            if (symbolRef.current === sym && sourceRef.current === src) {
                console.error("Pull failed");
            }
        } finally {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setPulling(false);
            }
        }
    }, [fetchStatus]);

    const fetchRatios = useCallback(async () => {
        const sym = symbolRef.current;
        const src = sourceRef.current;
        if (!sym || !src) return;
        setRatiosLoading(true);
        try {
            const result = await VoyagerService.getFinancialRatios(sym, src);
            if (sym !== symbolRef.current || src !== sourceRef.current) return;
            setRatiosData(result?.records ? result : null);
        } catch {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setRatiosData(null);
            }
        } finally {
            if (symbolRef.current === sym && sourceRef.current === src) {
                setRatiosLoading(false);
            }
        }
    }, []);

    const handleStockSelect = useCallback((field: string, value: string, item?: any) => {
        if (value === lastSeenSymbol.current) return;
        lastSeenSymbol.current = value;
        setSymbol(value);
        setName(
            item
                ? (item[sourceKeys.secondaryKey] || item.name || item.NAME || "")
                : ""
        );
        setStockData(null);
        setStatus(null);
        setRatiosData(null);
        setStatusNotFound(false);
        setPullComplete(false);
        setSelectedMetrics([]);
        setStatusAvailableMetrics(null);
        setStatusMetricsCatalog(null);
        setLimit(0);
    }, [sourceKeys]);

    useEffect(() => {
        if (symbolFromUrl) {
            handleStockSelect("share", symbolFromUrl);
            fetchStatus();
        }
    }, []);

    useEffect(() => {
        if (symbol && source) {
            fetchStatus();
        }
    }, [symbol, source, fetchStatus]);

    const dataCategories = useMemo(() => {
        if (!stockData) return [];
        const source = stockData.data || stockData;
        if (typeof source !== "object") return [];
        return Object.entries(source)
            .filter(([, records]: any) => Array.isArray(records) && records.length > 0)
            .map(([key, records]) => ({ key, records: records as any[] }));
    }, [stockData]);

    const formatDate = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            });
        } catch {
            return dateStr;
        }
    };

    const hasData = stockData && dataCategories.length > 0;

    const ratioCategories = useMemo(() => {
        if (!ratiosData?.records?.length) return [];
        const records = ratiosData.records;
        const cats = records[0]?.ratios ? Object.keys(records[0].ratios) : [];
        const result: { key: string; records: any[] }[] = [];
        for (const cat of cats) {
            const ratioNames = [...new Set<string>(
                records.flatMap((r: any) => r.ratios?.[cat] ? Object.keys(r.ratios[cat]) : [])
            )];
            result.push({
                key: cat,
                records: ratioNames.map((name: string) => {
                    const row: any = { ratio: name.replace(/_/g, " ") };
                    records.forEach((r: any) => { row[r.date] = r.ratios?.[cat]?.[name] ?? "-"; });
                    return row;
                })
            });
        }
        if (records[0]?.growth) {
            const names = Object.keys(records[0].growth);
            result.push({
                key: "growth",
                records: names.map((name: string) => {
                    const row: any = { ratio: name.replace(/_/g, " ") };
                    records.forEach((r: any) => { row[r.date] = r.growth?.[name] ?? "-"; });
                    return row;
                })
            });
        }
        return result;
    }, [ratiosData]);

    return (
        <Flex direction={"column"} gap={6} py={4}>
            <Flex justify={"space-between"} align="center">
                <Text textStyle={"3xl"} fontWeight="bold" letterSpacing="tight">
                    Stock Data Manager
                </Text>
            </Flex>

            {/* Search Section */}
            <Box bg="bg.subtle" border="1px solid" borderColor="border" rounded="md" p={6}>
                <Flex direction={{ base: "column", md: "row" }} gap={4} align={{ md: "end" }}>
                    <Box width={{ base: "full", md: "240px" }} flexShrink={0}>
                        <Text mb={2} fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Source</Text>
                        <Select.Root
                            collection={sourceOptions}
                            value={[source]}
                            onValueChange={(e) => {
                                setSource(e.value[0]);
                                setSymbol("");
                                setName("");
                                setStockData(null);
                                setRatiosData(null);
                                setStatus(null);
                                setStatusNotFound(false);
                                setPullComplete(false);
                                setSelectedMetrics([]);
                                setStatusAvailableMetrics(null);
                                setStatusMetricsCatalog(null);
                                setLimit(0);
                            }}
                        >
                            <Select.HiddenSelect />
                            <Select.Control>
                                <Select.Trigger>
                                    <Select.ValueText placeholder="Select source" />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Portal>
                                <Select.Positioner>
                                    <Select.Content>
                                        {sourceOptions.items.map((item: any) => (
                                            <Select.Item item={item} key={item.value}>
                                                {item.label}
                                                <Select.ItemIndicator />
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Portal>
                        </Select.Root>
                    </Box>

                    <Box flex="1">
                        <Text mb={2} fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">Search Stock</Text>
                        <SearchBar
                            url={`${NEBULA_BASE}/search-stocks`}
                            mainKey={sourceKeys.mainKey}
                            secondaryKey={sourceKeys.secondaryKey}
                            onChange={handleStockSelect}
                            field="share"
                            params={{ source }}
                            placeholder={source === "SEC" ? "Search by ticker or company name..." : "Search by symbol or company name..."}
                        />
                    </Box>
                </Flex>
            </Box>

            {/* Stock Info & Actions */}
            {symbol && (
                <Box bg="bg.subtle" border="1px solid" borderColor="border" rounded="md" p={6}>
                    <Flex direction={{ base: "column", md: "row" }} justify="space-between" align={{ md: "center" }} gap={4}>
                        <HStack gap={3}>
                            <Box bg="bg.muted" px={3} py={1.5} rounded="sm">
                                <Text fontSize="lg" fontWeight="bold" fontFamily="mono">{symbol}</Text>
                            </Box>
                            {name && <Text fontSize="sm" color="fg.muted">{name}</Text>}
                            <Badge variant="surface" colorPalette={source === "SEC" ? "blue" : "orange"} size="sm">
                                {source}
                            </Badge>
                            {pullComplete && !pulling && (
                                <MdCheckCircle size={18} color="var(--chakra-colors-green-400)" />
                            )}
                        </HStack>
                        <HStack gap={2}>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={pullData}
                                loading={pulling}
                                loadingText="Pulling..."
                                disabled={statusLoading}
                            >
                                <MdOutlineRefresh size={14} />
                                Pull Latest Data
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="blue"
                                onClick={fetchData}
                                loading={dataLoading}
                                loadingText="Loading..."
                                disabled={statusLoading}
                            >
                                <MdOutlineStorage size={14} />
                                Load Data
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="purple"
                                onClick={fetchRatios}
                                loading={ratiosLoading}
                                loadingText="Calculating..."
                                disabled={statusLoading}
                            >
                                <MdAssessment size={14} />
                                Calculate Ratios
                            </Button>
                        </HStack>
                    </Flex>

                    <Separator borderColor="border" my={4} />

                    {statusLoading ? (
                        <Flex justify="center" py={6}>
                            <HStack gap={2}>
                                <Spinner size="sm" />
                                <Text fontSize="sm" color="fg.subtle">Checking data status...</Text>
                            </HStack>
                        </Flex>
                    ) : statusNotFound ? (
                        <Flex direction="column" align="center" gap={2} py={6}>
                            <MdErrorOutline size={24} color="fg.muted" />
                            <Text fontSize="sm" color="fg.subtle">No data found for <Kbd>{symbol}</Kbd> on {source}</Text>
                            <Text fontSize="xs" color="fg.muted">Use "Pull Latest Data" to fetch it for the first time</Text>
                        </Flex>
                    ) : status ? (
                        <VStack gap={4} align="stretch">
                            <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={4}>
                                <Box bg="bg.muted" p={3} rounded="sm">
                                    <HStack gap={2} mb={1}>
                                        <MdHistory size={14} color="fg.subtle" />
                                        <Text fontSize="xs" color="fg.subtle">Last Pull</Text>
                                    </HStack>
                                    <Text fontSize="sm" fontWeight="medium">{formatDate(status.last_pull)}</Text>
                                </Box>
                                <Box bg="bg.muted" p={3} rounded="sm">
                                    <HStack gap={2} mb={1}>
                                        <MdOutlineRefresh size={14} color="fg.subtle" />
                                        <Text fontSize="xs" color="fg.subtle">Total Pulls</Text>
                                    </HStack>
                                    <Text fontSize="sm" fontWeight="medium">{status.total_pulls ?? "-"}</Text>
                                </Box>
                                <Box bg="bg.muted" p={3} rounded="sm">
                                    <HStack gap={2} mb={1}>
                                        <MdCalendarToday size={14} color="fg.subtle" />
                                        <Text fontSize="xs" color="fg.subtle">Created</Text>
                                    </HStack>
                                    <Text fontSize="sm" fontWeight="medium">{formatDate(status.created_at)}</Text>
                                </Box>
                                <Box bg="bg.muted" p={3} rounded="sm">
                                    <HStack gap={2} mb={1}>
                                        <MdOutlineCloudDone size={14} color="fg.subtle" />
                                        <Text fontSize="xs" color="fg.subtle">Updated</Text>
                                    </HStack>
                                    <Text fontSize="sm" fontWeight="medium">{formatDate(status.updated_at)}</Text>
                                </Box>
                            </SimpleGrid>

                            {status.record_counts && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Record Counts</Text>
                                    <Flex gap={2} flexWrap="wrap">
                                        {Object.entries(status.record_counts).map(([key, count]: any) => (
                                            <Badge key={key} variant="surface" colorPalette="gray" color="fg.muted" bg="bg.muted" px={2} py={1} rounded="sm" fontSize="xs">
                                                {key}: {count}
                                            </Badge>
                                        ))}
                                    </Flex>
                                </Box>
                            )}

                            {statusAvailableMetrics && Object.keys(statusAvailableMetrics).length > 0 && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Available Metrics</Text>
                                    <VStack gap={2} align="stretch">
                                        {Object.entries(statusAvailableMetrics).map(([col, metrics]: [string, any]) => (
                                            <Box key={col}>
                                                <Text fontSize="xs" color="fg.muted" mb={1}>{col}: {(metrics as string[]).length} metrics</Text>
                                                <Flex gap={1} flexWrap="wrap">
                                                    {(metrics as string[]).slice(0, 15).map((m: string) => (
                                                        <Badge key={m} variant="surface" colorPalette="gray" bg="bg.muted" px={1.5} py={0.5} rounded="sm" fontSize="xs">
                                                            {m}
                                                        </Badge>
                                                    ))}
                                                    {(metrics as string[]).length > 15 && (
                                                        <Text fontSize="xs" color="fg.muted">+{(metrics as string[]).length - 15} more</Text>
                                                    )}
                                                </Flex>
                                            </Box>
                                        ))}
                                    </VStack>
                                </Box>
                            )}

                            {statusMetricsCatalog && statusMetricsCatalog.length > 0 && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Metrics Catalog</Text>
                                    <Flex gap={1.5} flexWrap="wrap">
                                        {statusMetricsCatalog.map((m: any) => (
                                            <Badge key={m.id} variant="surface" colorPalette="blue" bg="bg.muted" px={1.5} py={0.5} rounded="sm" fontSize="xs">
                                                {m.name} <Text as="span" color="fg.muted">({m.category ?? m.type})</Text>
                                            </Badge>
                                        ))}
                                    </Flex>
                                </Box>
                            )}

                            {collectionOptions.length > 0 && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Collections to Load</Text>
                                    <Flex gap={3} flexWrap="wrap">
                                        {collectionOptions.map(col => (
                                            <Checkbox.Root
                                                key={col}
                                                checked={selectedCollections.includes(col)}
                                                onCheckedChange={({ checked }) => {
                                                    setSelectedCollections(prev =>
                                                        checked === true
                                                            ? [...prev, col]
                                                            : prev.filter(c => c !== col)
                                                    );
                                                }}
                                                size="xs"
                                            >
                                                <Checkbox.HiddenInput />
                                                <Checkbox.Control />
                                                <Checkbox.Label fontSize="xs">{col}</Checkbox.Label>
                                            </Checkbox.Root>
                                        ))}
                                    </Flex>
                                </Box>
                            )}

                            {allMetricTags.length > 0 && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Metric Filters (optional)</Text>
                                    <Flex gap={3} flexWrap="wrap" mb={3}>
                                        {allMetricTags.map(tag => (
                                            <Checkbox.Root
                                                key={tag}
                                                checked={selectedMetrics.includes(tag)}
                                                onCheckedChange={({ checked }) => {
                                                    setSelectedMetrics(prev =>
                                                        checked === true
                                                            ? [...prev, tag]
                                                            : prev.filter(t => t !== tag)
                                                    );
                                                }}
                                                size="xs"
                                            >
                                                <Checkbox.HiddenInput />
                                                <Checkbox.Control />
                                                <Checkbox.Label fontSize="xs">{tag}</Checkbox.Label>
                                            </Checkbox.Root>
                                        ))}
                                    </Flex>
                                    <HStack gap={2} align="center">
                                        <Text fontSize="xs" color="fg.subtle" whiteSpace="nowrap">Limit per collection:</Text>
                                        <Input
                                            type="number"
                                            size="sm"
                                            variant="subtle"
                                            placeholder="No limit"
                                            value={limit || ""}
                                            onChange={(e) => setLimit(parseInt(e.target.value) || 0)}
                                            width="100px"
                                            minW="100px"
                                        />
                                    </HStack>
                                </Box>
                            )}

                            {status.previous_pulls && status.previous_pulls.length > 0 && (
                                <Box>
                                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest" mb={2}>Previous Pulls</Text>
                                    <Flex gap={1.5} flexWrap="wrap">
                                        {status.previous_pulls.map((date: string, i: number) => (
                                            <Text key={i} fontSize="xs" color="fg.muted" fontFamily="mono">
                                                {formatDate(date)}
                                            </Text>
                                        ))}
                                    </Flex>
                                </Box>
                            )}
                        </VStack>
                    ) : (
                        <Flex justify="center" py={4}>
                            <Text fontSize="sm" color="fg.subtle">Unable to fetch status</Text>
                        </Flex>
                    )}
                </Box>
            )}

            {/* Data Tables */}
            {dataLoading ? (
                <Flex justify="center" py={10}>
                    <HStack gap={3}>
                        <Spinner size="lg" borderWidth="3px" />
                        <Text color="fg.subtle">Loading stock data...</Text>
                    </HStack>
                </Flex>
            ) : stockData ? (
                <Box>
                    <Flex justify="space-between" align="center" mb={4}>
                        <Text fontSize="sm" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                            Stock Data · {stockData.total_records ?? 0} total records
                            {!hasData && " · no categories loaded"}
                        </Text>
                    </Flex>
                    {hasData ? (
                        <VStack gap={3} align="stretch">
                            {dataCategories.map(({ key, records }) => (
                                <DataTableSection key={key} title={key} records={records} />
                            ))}
                        </VStack>
                    ) : (
                        <Flex justify="center" py={8}>
                            <Text color="fg.subtle">Response received but no data categories found</Text>
                        </Flex>
                    )}
                </Box>
            ) : null}

            {/* Ratios */}
            {ratiosLoading ? (
                <Flex justify="center" py={10}>
                    <HStack gap={3}>
                        <Spinner size="lg" borderWidth="3px" />
                        <Text color="fg.subtle">Calculating financial ratios...</Text>
                    </HStack>
                </Flex>
            ) : ratiosData ? (
                <Box>
                    <Flex justify="space-between" align="center" mb={4}>
                        <Text fontSize="sm" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                            Financial Ratios · {ratiosData.symbol} · {ratiosData.consolidated ?? "Consolidated"}
                        </Text>
                        <Badge variant="surface" colorPalette="purple" size="sm">{ratiosData.records?.length ?? 0} periods</Badge>
                    </Flex>
                    {ratioCategories.length > 0 ? (
                        <VStack gap={3} align="stretch">
                            {ratioCategories.map(({ key, records }) => (
                                <DataTableSection key={key} title={key.replace(/_/g, " ")} records={records} />
                            ))}
                        </VStack>
                    ) : (
                        <Flex justify="center" py={8}>
                            <Text color="fg.subtle">No ratio data found</Text>
                        </Flex>
                    )}
                </Box>
            ) : null}
        </Flex>
    );
}

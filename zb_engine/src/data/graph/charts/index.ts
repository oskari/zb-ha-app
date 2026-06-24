/**
 * charts/index.ts — Chart type registry
 *
 * Maps chart type strings to their generator functions.
 * To add a new chart type:
 *   1. Create a new generator file (e.g. scatterChart.ts)
 *   2. Register it in CHART_REGISTRY below
 *   3. Add the type to ChartType in types.ts
 * No other files need to change.
 */

import type { ChartGenerator } from "../types";
import { generateLineChart } from "./lineChart";
import { generateBarChart } from "./barChart";

/** Registry of chart type → generator function. */
const CHART_REGISTRY: Record<string, ChartGenerator> = {
  line: generateLineChart,
  bar: generateBarChart,
};

/**
 * Look up the chart generator for a given chart type.
 * Returns null if the chart type is not registered.
 */
export function getChartGenerator(chartType: string): ChartGenerator | null {
  return CHART_REGISTRY[chartType] ?? null;
}

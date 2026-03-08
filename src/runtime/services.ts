import {
	SyncService,
	TaskService,
	UsageMetricsService,
	WorkflowGuideService,
} from "@vem/core";

const taskService = new TaskService();
const syncService = new SyncService();
const metricsService = new UsageMetricsService();
const workflowGuide = new WorkflowGuideService(metricsService);
const TASK_CONTEXT_FILE = "task_context.md";

const parseCommaList = (value?: string): string[] | undefined => {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return [];
	return trimmed
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
};

const resolveActorName = (value?: string) => {
	const trimmed = value?.trim();
	if (trimmed) return trimmed;
	return (
		process.env.VEM_AGENT_NAME ||
		process.env.VEM_ACTOR ||
		process.env.VEM_AGENT ||
		undefined
	);
};

export {
	TASK_CONTEXT_FILE,
	metricsService,
	parseCommaList,
	resolveActorName,
	syncService,
	taskService,
	workflowGuide,
};

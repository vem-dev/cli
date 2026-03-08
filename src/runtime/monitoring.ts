export interface MonitoringConfig {
	dsn: string;
	environment: string;
	release?: string;
	serviceName: string;
	sampleRate?: number;
}

type SentryModule = {
	init: (config: unknown) => void;
	httpIntegration?: (config: {
		trackIncomingRequestsAsSessions: boolean;
	}) => unknown;
	captureException?: (error: unknown) => void;
};

let sentry: SentryModule | null = null;

export const NodeSentry = {
	captureException(error: unknown) {
		sentry?.captureException?.(error);
	},
};

export async function initServerMonitoring(config: MonitoringConfig) {
	if (!config.dsn) {
		if (config.environment !== "development") {
			console.warn(
				`[monitoring] Sentry DSN missing for ${config.serviceName} in ${config.environment}`,
			);
		}
		return;
	}

	try {
		const loaded = (await import("@sentry/node")) as SentryModule;
		sentry = loaded;

		loaded.init({
			dsn: config.dsn,
			environment: config.environment,
			release: config.release,
			integrations: loaded.httpIntegration
				? [
						loaded.httpIntegration({
							trackIncomingRequestsAsSessions: true,
						}),
					]
				: [],
			tracesSampleRate:
				config.sampleRate ?? (config.environment === "production" ? 0.1 : 1.0),
			initialScope: {
				tags: {
					service: config.serviceName,
				},
			},
		});
	} catch (error) {
		console.warn(
			`[monitoring] Failed to initialize Sentry for ${config.serviceName}: ${String(
				(error as Error)?.message ?? error,
			)}`,
		);
	}
}

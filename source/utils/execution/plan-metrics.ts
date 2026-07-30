import {performance} from 'node:perf_hooks';
import {
	recordPlanOperationDuration,
	type TelemetryPlanOperationAttributes,
} from '../telemetry/otel.js';

type PlanTimingBase = Pick<
	TelemetryPlanOperationAttributes,
	'operation' | 'detail'
>;

export type PlanTimingContext = {
	cache: TelemetryPlanOperationAttributes['cache'];
};

type PlanTimingDependencies = {
	now?: () => number;
	record?: (attributes: TelemetryPlanOperationAttributes) => void;
};

export async function measurePlanOperation<T>(
	attributes: PlanTimingBase,
	operation: (context: PlanTimingContext) => Promise<T>,
	dependencies: PlanTimingDependencies = {},
): Promise<T> {
	const now = dependencies.now ?? (() => performance.now());
	const record = dependencies.record ?? recordPlanOperationDuration;
	const context: PlanTimingContext = {cache: 'none'};
	const start = now();
	let outcome: TelemetryPlanOperationAttributes['outcome'] = 'error';

	try {
		const result = await operation(context);
		outcome = 'success';
		return result;
	} finally {
		try {
			record({
				...attributes,
				outcome,
				cache: context.cache,
				durationMs: Math.max(0, now() - start),
			});
		} catch {
			// Metrics are observational and must not affect Plan behavior.
		}
	}
}

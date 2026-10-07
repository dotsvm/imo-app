/**
 * Venues that trade from the trader's own wallet. Adding one is a module
 * here; the route, the API and the apps pick it up from this list.
 */
import { jupiterExecution } from "./jupiter/execution";
import type { ExecutionModule } from "./sdk/execution";

export const EXECUTION_MODULES: readonly ExecutionModule[] = [jupiterExecution];

export const WALLET_VENUES: readonly string[] = EXECUTION_MODULES.flatMap((m) => m.venues);

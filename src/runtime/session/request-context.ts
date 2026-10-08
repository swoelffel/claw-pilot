import { AsyncLocalStorage } from "node:async_hooks";

export interface RuntimeRequestContext {
  requestId: string;
  traceId: string;
  executionId: string;
}

export const runtimeRequestContext = new AsyncLocalStorage<RuntimeRequestContext>();

import { AsyncLocalStorage } from "node:async_hooks";

export interface RuntimeRequestContext {
  requestId: string;
  traceId: string;
  executionId: string;
  businessTaskId?: string;
}

export const runtimeRequestContext = new AsyncLocalStorage<RuntimeRequestContext>();

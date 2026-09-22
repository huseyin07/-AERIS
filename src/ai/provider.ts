import type {AerisAnswer} from "./deterministic";
export type ProviderContext = {query: string; deterministicContext: unknown};
export interface AerisAiProvider { answer(context: ProviderContext): Promise<AerisAnswer>; }
/** Future server-only providers implement this interface. The application deliberately has no required provider or client-side key. */
export function configuredProvider(): AerisAiProvider | null { return null; }

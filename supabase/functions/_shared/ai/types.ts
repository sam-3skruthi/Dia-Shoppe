// Provider-neutral AI types. Nothing in here (or in whatsapp-inbound) knows which model is behind the abstraction.

export type Locale = "en" | "hi" | "kn" | "te";

export type Intent =
  | "product_info" | "price" | "stock" | "order_status" | "delivery" | "returns_refund"
  | "complaint" | "store_info" | "medical" | "smalltalk" | "other";
export const INTENTS: Intent[] = ["product_info", "price", "stock", "order_status", "delivery", "returns_refund", "complaint", "store_info", "medical", "smalltalk", "other"];

// Built ONLY by the server (support-context.ts) from data this customer is allowed to see.
// There is deliberately no field for cost price, other customers, payment ids, emails or full addresses.
export type SupportContext = {
  customer: { known: boolean; firstName?: string };
  store: { name: string; website?: string; phones: string[]; emails: string[]; policies: string };
  catalog: { name: string; brand: string; category: string; price: number; inStock: boolean }[];
  orders: { id: number; status: string; total: number; placedOn: string; items: string[]; courier?: string; tracking?: string }[];
  ownerInstructions?: string;
};

export type SupportReply = { text: string; intent: Intent; confidence: number; needsHuman: boolean };

export type ProviderRequest = { system: string; user: string; model: string; timeoutMs: number; maxTokens: number; temperature: number };
export type ProviderResponse = { text: string; inputTokens: number; outputTokens: number };
export interface AiProvider {
  name: string;
  chat(req: ProviderRequest): Promise<ProviderResponse>;
}

export type ErrorKind = "disabled" | "timeout" | "provider_error" | "bad_output" | "validation";
export class SupportReplyError extends Error {
  kind: ErrorKind;
  retryable: boolean;
  usage?: { inputTokens: number; outputTokens: number };   // tokens already spent when the failure happened (validation failures still cost money)
  constructor(kind: ErrorKind, message: string, retryable = false) {
    super(message);
    this.name = "SupportReplyError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

/** What an import detected about the API. Suggestions the user confirms later (slice 3). */

export type DetectedAuth =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query"; name: string }
  | { type: "bearer" }
  | { type: "basic" }
  | { type: "unsupported"; scheme: string };

export type DetectedConfig = {
  apiTitle: string;
  apiVersion?: string;
  baseUrl?: string; // first usable https server
  baseUrlCandidates: string[];
  /** Hostname placeholders like {subdomain}: per-customer values the user fills in when connecting. */
  baseUrlVariables?: Record<string, { enum?: string[]; default?: string; description?: string }>;
  auth: DetectedAuth;
  warnings: string[];
};

export type SkippedOperation = { method: string; path: string; reason: string };

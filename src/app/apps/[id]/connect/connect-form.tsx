"use client";

import { useActionState, useState } from "react";
import { templateVars } from "@/lib/base-url";
import { saveConnectionAction, type ConnectState } from "./actions";

type AuthType = "none" | "api_key" | "bearer" | "basic";

type Initial = {
  baseUrlTemplate: string;
  candidates: string[];
  variables: Record<string, { enum?: string[]; default?: string; description?: string }>;
  authType: AuthType | null;
  apiKey?: { in: "header" | "query" | "path"; name: string };
  detectedNote?: string;
  credential: { hint: string; status: "active" | "needs_reconnect" } | null;
};

const AUTH_OPTIONS: { value: AuthType; label: string; hint: string }[] = [
  { value: "api_key", label: "API key", hint: "A key sent in a header or the address, e.g. X-Api-Key." },
  { value: "bearer", label: "Access token", hint: "Sent as \"Authorization: Bearer …\". Some tokens expire (OAuth tokens often last 30 minutes to 2 days); when one does, Health says Needs reconnect and you paste a fresh one." },
  { value: "basic", label: "Username and password", hint: "Basic auth. Some apps use the API key as the username and any text (like x) as the password." },
  { value: "none", label: "No sign-in", hint: "Only for public APIs." },
];

type Guide = {
  /** Plain-language meaning of each address placeholder (from the catalog). */
  placeholders: Record<string, string>;
  /** What goes in username and password, for apps that use basic sign-in. */
  basic?: { username: string; password: string };
};

export function ConnectForm({ connectorId, initial, guide }: { connectorId: string; initial: Initial; guide?: Guide }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(saveConnectionAction, {});
  const [template, setTemplate] = useState(initial.baseUrlTemplate);
  const [authType, setAuthType] = useState<AuthType>(initial.authType ?? "api_key");
  const vars = templateVars(template);
  const keepNote = (type: AuthType) =>
    initial.credential && initial.authType === type ? `Saved: ${initial.credential.hint}. Leave blank to keep it.` : undefined;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="connectorId" value={connectorId} />

      {initial.credential?.status === "needs_reconnect" && (
        <p role="alert" className="bevel-in p-3">
          <span className="text-alarm font-bold">⚠ Needs reconnect.</span> The app rejected the saved key. Enter a new one below.
        </p>
      )}

      <fieldset className="groupbox">
        <legend>Server address</legend>
        <div className="flex flex-col gap-2">
          <label htmlFor="baseUrlTemplate" className="font-semibold">
            The API&apos;s base address
          </label>
          <input
            id="baseUrlTemplate"
            name="baseUrlTemplate"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="https://api.example.com/v2"
            className="field font-mono text-sm"
            aria-invalid={state.field === "baseUrl"}
            required
          />
          {initial.candidates.length > 1 && (
            <p className="text-sm">
              Other addresses in the docs:{" "}
              {initial.candidates.slice(1, 4).map((c) => (
                <button key={c} type="button" className="mr-2 underline" onClick={() => setTemplate(c)}>
                  {c}
                </button>
              ))}
            </p>
          )}
          {vars.map((name) => (
            <div key={name} className="flex flex-col gap-1">
              <label htmlFor={`var_${name}`} className="font-semibold">
                Your {name}
              </label>
              {initial.variables[name]?.enum?.length ? (
                <select id={`var_${name}`} name={`var_${name}`} className="field max-w-sm" defaultValue={initial.variables[name].default ?? initial.variables[name].enum![0]}>
                  {initial.variables[name].enum!.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input id={`var_${name}`} name={`var_${name}`} className="field max-w-sm" required autoComplete="off" spellCheck={false} />
              )}
              {initial.variables[name]?.description && <p className="text-sm text-ink-soft">{initial.variables[name].description}</p>}
              <p className="text-sm text-ink-soft">
                {guide?.placeholders[name] ?? (
                  <>
                    The address has a placeholder, {"{"}
                    {name}
                    {"}"}. For example, if you sign in at https://acme.app.com, it&apos;s usually &quot;acme&quot;.
                  </>
                )}
              </p>
            </div>
          ))}
          <p className="text-sm text-ink-soft">We only ever send requests to this address, and only over https.</p>
        </div>
      </fieldset>

      <fieldset className="groupbox">
        <legend>How the app signs in</legend>
        <div className="flex flex-col gap-3">
          {initial.detectedNote && <p className="text-sm">ℹ {initial.detectedNote}</p>}
          {AUTH_OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="authType" value={o.value} checked={authType === o.value} onChange={() => setAuthType(o.value)} className="chk mt-1" />
              <span>
                <span className="font-semibold">{o.label}</span>
                <span className="block text-sm text-ink-soft">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {authType !== "none" && (
        <fieldset className="groupbox">
          <legend>Your {authType === "basic" ? "username and password" : authType === "bearer" ? "token" : "API key"}</legend>
          <div className="flex flex-col gap-3">
            {authType === "api_key" && (
              <>
                <div className="flex flex-wrap gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">Sent in</span>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input type="radio" name="apiKeyIn" value="header" defaultChecked={initial.apiKey?.in !== "query"} className="chk" />
                        A header
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" name="apiKeyIn" value="query" defaultChecked={initial.apiKey?.in === "query"} className="chk" />
                        The address (query)
                      </label>
                      {initial.apiKey?.in === "path" && (
                        <label className="flex items-center gap-2">
                          <input type="radio" name="apiKeyIn" value="path" defaultChecked className="chk" />
                          Part of the address (path)
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="apiKeyName" className="font-semibold">
                      Named
                    </label>
                    <input id="apiKeyName" name="apiKeyName" defaultValue={initial.apiKey?.name ?? "X-Api-Key"} className="field font-mono text-sm" aria-invalid={state.field === "apiKeyName"} />
                  </div>
                </div>
                <SecretInput id="apiKeyValue" label="API key" note={keepNote("api_key")} />
              </>
            )}
            {authType === "bearer" && <SecretInput id="bearerToken" label="Access token" note={keepNote("bearer")} />}
            {authType === "basic" && (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="basicUsername" className="font-semibold">
                    Username
                  </label>
                  <input
                    id="basicUsername"
                    name="basicUsername"
                    autoComplete="off"
                    spellCheck={false}
                    className="field font-mono text-sm"
                    aria-invalid={state.field === "basicUsername"}
                    aria-describedby={guide?.basic ? "basicUsername-hint" : undefined}
                  />
                  {guide?.basic && (
                    <p id="basicUsername-hint" className="text-sm text-ink-soft">
                      {guide.basic.username}
                    </p>
                  )}
                </div>
                <SecretInput id="basicPassword" label="Password" note={keepNote("basic")} hint={guide?.basic?.password} />
              </>
            )}
            <p className="text-sm">🔒 Stored encrypted. After you save, we only show its last four characters. It&apos;s never sent to the AI.</p>
          </div>
        </fieldset>
      )}

      {state.error && (
        <p role="alert" className="bevel-in p-3">
          <span className="text-alarm">⚠ </span>
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving and checking…" : "Save and check"}
        </button>
      </div>
    </form>
  );
}

function SecretInput({ id, label, note, hint }: { id: string; label: string; note?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input id={id} name={id} type="password" autoComplete="new-password" spellCheck={false} className="field font-mono text-sm" placeholder={note ? "••••••••" : ""} />
      {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      {note && <p className="text-sm text-ink-soft">{note}</p>}
    </div>
  );
}

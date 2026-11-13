/**
 * The app catalog: start from an app's name instead of a docs link.
 * Facts (spec URLs, sign-in, key steps, job paths) were checked against each
 * vendor's own docs on 13 Nov 2026, and every entry must pass a real import
 * (src/lib/catalog.integration.test.ts) before it ships. Plain data, safe for
 * client and server; the server resolves a key to its URL, so the browser
 * can't supply a "catalog" URL.
 */
import type { HttpMethod } from "./ir";

export type CatalogAuth =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query" | "path"; name: string }
  | { type: "bearer" }
  | { type: "basic"; username: string; password: string };

export type CatalogJob = {
  key: string;
  title: string;
  description: string;
  /** Operations as in the spec; path parameters may be named anything. */
  ops: { method: HttpMethod; path: string }[];
};

export type CatalogApp = {
  key: string;
  name: string;
  category: "Support" | "HR" | "Sales" | "Marketing" | "Productivity" | "Payments" | "Developer" | "Messaging" | "AI & media" | "Data" | "Sample";
  /** What an AI employee could do with it, in one line. */
  blurb: string;
  source: { kind: "openapi_url" | "docs_url"; url: string };
  sample?: boolean;
  /** Server address to start from, when the docs' own one is a stand-in (e.g. "your-domain"). */
  baseUrl?: string;
  /** POSTs the vendor documents as read-only (searches, queries): these start as reads, with no approval. */
  readOps?: { method: HttpMethod; path: string }[];
  auth: CatalogAuth;
  /** Plain-language meaning of each server-address placeholder, e.g. subdomain. */
  placeholders?: Record<string, string>;
  /** Where to find or create the key: 3–5 short steps. */
  keySteps: string[];
  keyHelpUrl?: string;
  adminNeeded?: boolean;
  jobs: CatalogJob[];
};

export const CATALOG: CatalogApp[] = [
  {
    key: "petstore",
    name: "Petstore (sample)",
    category: "Sample",
    blurb: "A public practice API. No account needed.",
    source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    sample: true,
    auth: { type: "none" },
    keySteps: ["Nothing to do: the sample needs no sign-in."],
    jobs: [
      {
        key: "browse",
        title: "Browse the pet shop",
        description: "Find pets by status and look one up.",
        ops: [
          { method: "GET", path: "/pet/findByStatus" },
          { method: "GET", path: "/pet/{petId}" },
        ],
      },
      {
        key: "add",
        title: "Add new pets",
        description: "Create pets (each one waits for your approval).",
        ops: [{ method: "POST", path: "/pet" }],
      },
    ],
  },
  {
    key: "zendesk",
    name: "Zendesk",
    category: "Support",
    blurb: "Read, answer and triage customer tickets.",
    source: { kind: "openapi_url", url: "https://developer.zendesk.com/zendesk/oas.yaml" },
    auth: { type: "basic", username: "Your Zendesk email followed by /token, for example you@company.com/token", password: "The API token" },
    placeholders: { subdomain: "Your Zendesk account name: the part before .zendesk.com. For acme.zendesk.com, it's acme." },
    keySteps: [
      "In Zendesk, open Admin Center, then Apps and integrations, then APIs, then API tokens.",
      "If token access is off, turn it on.",
      "Click Add API token, give it a description like \"BYOMCP\", and save.",
      "Copy the token now: Zendesk shows it only once.",
      "Here, the username is your Zendesk email followed by /token, and the password is the token.",
    ],
    keyHelpUrl: "https://support.zendesk.com/hc/en-us/articles/4408889192858",
    adminNeeded: true,
    jobs: [
      {
        key: "tickets",
        title: "Answer customer tickets",
        description: "See tickets, read the conversation, and reply or update (replies wait for your approval).",
        ops: [
          { method: "GET", path: "/api/v2/tickets" },
          { method: "GET", path: "/api/v2/tickets/{ticket_id}" },
          { method: "GET", path: "/api/v2/tickets/{ticket_id}/comments" },
          { method: "PUT", path: "/api/v2/tickets/{ticket_id}" },
        ],
      },
      {
        key: "customers",
        title: "Find a customer's history",
        description: "Find a customer and search their past tickets.",
        ops: [
          { method: "GET", path: "/api/v2/users/search" },
          { method: "GET", path: "/api/v2/users/{user_id}" },
          { method: "GET", path: "/api/v2/search" },
        ],
      },
      {
        key: "triage",
        title: "Triage new tickets",
        description: "Find new tickets and set priority, assignee or tags (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/api/v2/search" },
          { method: "PUT", path: "/api/v2/tickets/{ticket_id}" },
        ],
      },
    ],
  },
  {
    key: "intercom",
    name: "Intercom",
    category: "Support",
    blurb: "Answer conversations and look up customers.",
    source: { kind: "openapi_url", url: "https://raw.githubusercontent.com/intercom/Intercom-OpenAPI/main/descriptions/2.15/api.intercom.io.yaml" },
    auth: { type: "bearer" },
    keySteps: [
      "Open Intercom's Developer Hub and create an app in your workspace.",
      "Open the app, then Configure, then Authentication.",
      "Copy the access token and paste it here.",
      "Good to know: Intercom recommends OAuth for outside tools. A token works, with the access of whoever installed the app.",
    ],
    keyHelpUrl: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication",
    jobs: [
      {
        key: "conversations",
        title: "Answer conversations",
        description: "Find conversations, read one, and reply (replies wait for your approval).",
        ops: [
          { method: "POST", path: "/conversations/search" },
          { method: "GET", path: "/conversations/{conversation_id}" },
          { method: "POST", path: "/conversations/{conversation_id}/reply" },
        ],
      },
      {
        key: "customers",
        title: "Look up a customer",
        description: "Search contacts and read their details.",
        ops: [
          { method: "POST", path: "/contacts/search" },
          { method: "GET", path: "/contacts/{contact_id}" },
        ],
      },
      {
        key: "articles",
        title: "Find help articles",
        description: "Search your help center.",
        ops: [{ method: "GET", path: "/articles/search" }],
      },
    ],
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "Sales",
    blurb: "Look up contacts and tickets, and log notes.",
    source: {
      kind: "openapi_url",
      url: "https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Objects/Rollouts/424/v3/objects.json",
    },
    auth: { type: "bearer" },
    keySteps: [
      "In HubSpot, go to Development, then Keys, then Service keys, and create a key.",
      "Name it \"BYOMCP\" and add the scopes it needs, for example crm.objects.contacts.read.",
      "Click Create, confirm, and copy the key.",
      "Paste it here as the access token.",
    ],
    keyHelpUrl: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys",
    adminNeeded: true,
    jobs: [
      {
        key: "customers",
        title: "Look up a customer",
        description: "Search contacts and read one (object type: contacts).",
        ops: [
          { method: "POST", path: "/crm/v3/objects/{objectType}/search" },
          { method: "GET", path: "/crm/v3/objects/{objectType}/{objectId}" },
        ],
      },
      {
        key: "tickets",
        title: "Handle support tickets",
        description: "List tickets and update them (object type: tickets; updates wait for your approval).",
        ops: [
          { method: "GET", path: "/crm/v3/objects/{objectType}" },
          { method: "PATCH", path: "/crm/v3/objects/{objectType}/{objectId}" },
        ],
      },
      {
        key: "notes",
        title: "Log a note",
        description: "Add a note to the CRM (object type: notes; waits for your approval).",
        ops: [{ method: "POST", path: "/crm/v3/objects/{objectType}" }],
      },
    ],
  },
  {
    key: "pipedrive",
    name: "Pipedrive",
    category: "Sales",
    blurb: "Find deals and people, update progress, plan follow-ups.",
    source: { kind: "openapi_url", url: "https://developers.pipedrive.com/docs/api/v1/openapi-v2.yaml" },
    auth: { type: "api_key", in: "header", name: "x-api-token" },
    keySteps: [
      "In Pipedrive, open Settings, then Personal preferences, then API.",
      "Copy your personal API token and paste it here.",
      "If you don't see the API page, your permission set doesn't include it: ask an admin.",
    ],
    keyHelpUrl: "https://support.pipedrive.com/en/article/how-can-i-find-my-personal-api-key",
    jobs: [
      {
        key: "find",
        title: "Find a customer or deal",
        description: "Search people and deals, and read a deal.",
        ops: [
          { method: "GET", path: "/persons/search" },
          { method: "GET", path: "/deals/search" },
          { method: "GET", path: "/deals/{id}" },
        ],
      },
      {
        key: "progress",
        title: "Update deal progress",
        description: "Move a deal along or edit it (waits for your approval).",
        ops: [{ method: "PATCH", path: "/deals/{id}" }],
      },
      {
        key: "followups",
        title: "Plan follow-ups",
        description: "See activities and schedule new ones (new ones wait for your approval).",
        ops: [
          { method: "GET", path: "/activities" },
          { method: "POST", path: "/activities" },
        ],
      },
    ],
  },
  {
    key: "bamboohr",
    name: "BambooHR",
    category: "HR",
    blurb: "Look up employees, see who's out, review time off.",
    source: { kind: "docs_url", url: "https://documentation.bamboohr.com/reference/get-employee" },
    auth: { type: "basic", username: "Your API key", password: "Any text, for example x" },
    placeholders: { companyDomain: "The part before .bamboohr.com in your BambooHR address. For acme.bamboohr.com, it's acme." },
    keySteps: [
      "In BambooHR, click your name in the lower-left corner.",
      "Choose API Keys. If you don't see it, your role doesn't allow it: ask an admin.",
      "Add a new key, name it \"BYOMCP\", and copy it. It's shown only once.",
      "Here, paste the key as the username and type x as the password.",
    ],
    keyHelpUrl: "https://documentation.bamboohr.com/docs/getting-started",
    jobs: [
      {
        key: "directory",
        title: "Look up an employee",
        description: "Search the directory and read an employee's details.",
        ops: [
          { method: "GET", path: "/api/v1/employees/directory" },
          { method: "GET", path: "/api/v1/employees/{id}" },
        ],
      },
      {
        key: "whos-out",
        title: "See who's out",
        description: "Who's on leave today and over the next two weeks.",
        ops: [{ method: "GET", path: "/api/v1/time_off/whos_out" }],
      },
      {
        key: "time-off",
        title: "Review time-off requests",
        description: "See pending and recent time-off requests (read only).",
        ops: [{ method: "GET", path: "/api/v1/time_off/requests" }],
      },
    ],
  },
  {
    key: "calendly",
    name: "Calendly",
    category: "Productivity",
    blurb: "Check upcoming meetings and send booking links.",
    source: { kind: "openapi_url", url: "https://developer.calendly.com/openapi/calendly-api.json" },
    auth: { type: "bearer" },
    keySteps: [
      "In Calendly, open the profile menu, then Developer (older accounts: Integrations, then API and webhooks).",
      "Under Personal access tokens, click Create token, name it and choose its access.",
      "Enter the code Calendly emails you, then copy the token. It's shown only once.",
    ],
    keyHelpUrl: "https://developer.calendly.com/personal-access-tokens",
    jobs: [
      {
        key: "meetings",
        title: "Check upcoming meetings",
        description: "See scheduled meetings and who's attending.",
        ops: [
          { method: "GET", path: "/users/me" },
          { method: "GET", path: "/scheduled_events" },
          { method: "GET", path: "/scheduled_events/{uuid}/invitees" },
        ],
      },
      {
        key: "booking",
        title: "Send a booking link",
        description: "Create a one-off scheduling link (waits for your approval).",
        ops: [
          { method: "GET", path: "/event_types" },
          { method: "POST", path: "/scheduling_links" },
        ],
      },
    ],
  },
  {
    key: "asana",
    name: "Asana",
    category: "Productivity",
    blurb: "Track tasks and projects, and add updates.",
    source: { kind: "openapi_url", url: "https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml" },
    auth: { type: "bearer" },
    keySteps: [
      "In Asana, click your profile photo, then Settings, then Apps.",
      "Click View developer console (or Manage developer apps), then Create new token.",
      "Name it \"BYOMCP\", agree to the terms, and create it.",
      "Copy the token now: Asana shows it only once. It acts as you, with your access.",
    ],
    keyHelpUrl: "https://developers.asana.com/docs/personal-access-token",
    jobs: [
      {
        key: "tasks",
        title: "Follow up on tasks",
        description: "Read a project's tasks and their comments, and comment or update (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/workspaces" },
          { method: "GET", path: "/projects" },
          { method: "GET", path: "/projects/{project_gid}/tasks" },
          { method: "GET", path: "/tasks/{task_gid}" },
          { method: "GET", path: "/tasks/{task_gid}/stories" },
          { method: "POST", path: "/tasks/{task_gid}/stories" },
          { method: "PUT", path: "/tasks/{task_gid}" },
        ],
      },
      {
        key: "create",
        title: "Create tasks",
        description: "Add tasks and subtasks to a project (each waits for your approval).",
        ops: [
          { method: "GET", path: "/projects" },
          { method: "POST", path: "/tasks" },
          { method: "POST", path: "/tasks/{task_gid}/subtasks" },
        ],
      },
    ],
  },
  {
    key: "jira",
    name: "Jira",
    category: "Developer",
    blurb: "Find and update issues, and log new ones.",
    source: { kind: "openapi_url", url: "https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json" },
    baseUrl: "https://{site}.atlassian.net",
    auth: { type: "basic", username: "Your Atlassian account email", password: "The API token" },
    placeholders: { site: "Your Jira site name: the part before .atlassian.net. For acme.atlassian.net, it's acme." },
    keySteps: [
      "Open id.atlassian.com/manage-profile/security/api-tokens and sign in.",
      "Click Create API token, name it \"BYOMCP\", and pick an expiry date.",
      "Copy the token now: Atlassian shows it only once.",
      "Here, the username is your Atlassian email and the password is the token. It has your Jira access.",
    ],
    keyHelpUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    readOps: [{ method: "POST", path: "/rest/api/3/search/jql" }],
    jobs: [
      {
        key: "issues",
        title: "Find and update issues",
        description: "Search issues, read one with its comments, and comment or update (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/rest/api/3/search/jql" },
          { method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}" },
          { method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/comment" },
          { method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/comment" },
          { method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}" },
        ],
      },
      {
        key: "create",
        title: "Log new issues",
        description: "Find the right project and create an issue (waits for your approval).",
        ops: [
          { method: "GET", path: "/rest/api/3/myself" },
          { method: "GET", path: "/rest/api/3/project/search" },
          { method: "POST", path: "/rest/api/3/issue" },
        ],
      },
    ],
  },
  {
    key: "webflow",
    name: "Webflow",
    category: "Marketing",
    blurb: "Read and update CMS content, and see form submissions.",
    source: { kind: "openapi_url", url: "https://raw.githubusercontent.com/webflow/openapi-spec/main/openapi/v2.yml" },
    auth: { type: "bearer" },
    keySteps: [
      "In Webflow, open the site's Site settings, then Apps & integrations.",
      "Under API access, click Generate API token and name it \"BYOMCP\".",
      "Give it read access to Sites, CMS and Forms (and write access to CMS if it should edit content).",
      "Copy the token now: Webflow shows it only once. A site token works for that one site.",
    ],
    keyHelpUrl: "https://developers.webflow.com/data/reference/site-token",
    adminNeeded: true,
    jobs: [
      {
        key: "cms",
        title: "Manage CMS content",
        description: "Read collections and items, and add or edit items (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/sites" },
          { method: "GET", path: "/sites/{site_id}/collections" },
          { method: "GET", path: "/collections/{collection_id}/items" },
          { method: "GET", path: "/collections/{collection_id}/items/{item_id}" },
          { method: "POST", path: "/collections/{collection_id}/items" },
          { method: "PATCH", path: "/collections/{collection_id}/items/{item_id}" },
        ],
      },
      {
        key: "forms",
        title: "Read form submissions",
        description: "See the site's forms and what people submitted.",
        ops: [
          { method: "GET", path: "/sites" },
          { method: "GET", path: "/sites/{site_id}/forms" },
          { method: "GET", path: "/forms/{form_id}/submissions" },
        ],
      },
    ],
  },
  {
    key: "mailchimp",
    name: "Mailchimp",
    category: "Marketing",
    blurb: "Manage audience contacts and check campaign results.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/mailchimp.json" },
    baseUrl: "https://{dc}.api.mailchimp.com/3.0",
    auth: { type: "basic", username: "Any word, for example byomcp (Mailchimp ignores it)", password: "The API key" },
    placeholders: { dc: "Your data center: the letters and number after the dash at the end of your API key. For a key ending in -us21, it's us21." },
    keySteps: [
      "In Mailchimp, click your profile icon, then Profile, then Extras, then API keys.",
      "Click Create A Key and name it \"BYOMCP\".",
      "Copy the key now: Mailchimp shows it only once.",
      "Here, the username can be any word and the password is the key.",
    ],
    keyHelpUrl: "https://mailchimp.com/help/about-api-keys/",
    jobs: [
      {
        key: "audience",
        title: "Manage audience contacts",
        description: "Find contacts, and add or update them (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/lists" },
          { method: "GET", path: "/lists/{list_id}/members" },
          { method: "GET", path: "/search-members" },
          { method: "POST", path: "/lists/{list_id}/members" },
          { method: "PATCH", path: "/lists/{list_id}/members/{subscriber_hash}" },
        ],
      },
      {
        key: "reports",
        title: "Check campaign results",
        description: "See campaigns and their opens, clicks and bounces.",
        ops: [
          { method: "GET", path: "/campaigns" },
          { method: "GET", path: "/reports" },
          { method: "GET", path: "/reports/{campaign_id}" },
        ],
      },
    ],
  },
  {
    key: "stripe",
    name: "Stripe (reads)",
    category: "Payments",
    blurb: "Look up customers, payments, invoices and subscriptions.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/stripe.json" },
    baseUrl: "https://api.stripe.com",
    auth: { type: "bearer" },
    keySteps: [
      "In the Stripe Dashboard, open Developers, then API keys. Try it in test mode first.",
      "Click Create restricted key and name it \"BYOMCP\".",
      "Set Read for Customers, Charges, PaymentIntents, Invoices, Subscriptions, Products, Prices, Balance, Refunds, Payouts and Disputes. Leave the rest at None.",
      "Create the key and copy it (it starts with rk_). Never use your secret key (sk_) here.",
    ],
    keyHelpUrl: "https://docs.stripe.com/keys#create-restricted-api-secret-key",
    adminNeeded: true,
    jobs: [
      {
        key: "customers",
        title: "Look up a customer",
        description: "Find a customer and see their payments, invoices and subscriptions.",
        ops: [
          { method: "GET", path: "/v1/customers/search" },
          { method: "GET", path: "/v1/customers/{customer}" },
          { method: "GET", path: "/v1/charges" },
          { method: "GET", path: "/v1/invoices" },
          { method: "GET", path: "/v1/subscriptions" },
        ],
      },
      {
        key: "money",
        title: "Check balance and payouts",
        description: "See the balance, payouts, refunds and disputes.",
        ops: [
          { method: "GET", path: "/v1/balance" },
          { method: "GET", path: "/v1/payouts" },
          { method: "GET", path: "/v1/refunds" },
          { method: "GET", path: "/v1/disputes" },
        ],
      },
    ],
  },
  {
    key: "notion",
    name: "Notion",
    category: "Productivity",
    blurb: "Search and read pages and databases, and add notes.",
    source: { kind: "openapi_url", url: "https://developers.notion.com/openapi.json" },
    auth: { type: "bearer" },
    keySteps: [
      "Open notion.so/profile/integrations and click New integration.",
      "Name it \"BYOMCP\", choose your workspace, and save. Copy the Internal Integration Secret.",
      "Open each page or database it should use, click the ••• menu, then Connections, and add BYOMCP.",
      "It can only see pages you've shared with it this way.",
    ],
    keyHelpUrl: "https://developers.notion.com/docs/authorization",
    readOps: [
      { method: "POST", path: "/v1/search" },
      { method: "POST", path: "/v1/data_sources/{data_source_id}/query" },
    ],
    jobs: [
      {
        key: "read",
        title: "Find and read pages",
        description: "Search the shared pages and read their content.",
        ops: [
          { method: "POST", path: "/v1/search" },
          { method: "GET", path: "/v1/pages/{page_id}" },
          { method: "GET", path: "/v1/pages/{page_id}/markdown" },
          { method: "GET", path: "/v1/blocks/{block_id}/children" },
        ],
      },
      {
        key: "databases",
        title: "Look things up in a database",
        description: "Read a database and filter its rows.",
        ops: [
          { method: "GET", path: "/v1/data_sources/{data_source_id}" },
          { method: "POST", path: "/v1/data_sources/{data_source_id}/query" },
        ],
      },
      {
        key: "write",
        title: "Add pages and notes",
        description: "Create pages, add content and comment (each waits for your approval).",
        ops: [
          { method: "POST", path: "/v1/pages" },
          { method: "PATCH", path: "/v1/blocks/{block_id}/children" },
          { method: "POST", path: "/v1/comments" },
        ],
      },
    ],
  },
  {
    key: "firecrawl",
    name: "Firecrawl",
    category: "AI & media",
    blurb: "Read any web page, map a site, or search the web.",
    source: { kind: "openapi_url", url: "https://docs.firecrawl.dev/api-reference/v2-openapi.json" },
    auth: { type: "bearer" },
    keySteps: [
      "Sign in at firecrawl.dev and open your dashboard.",
      "Under API Keys, copy your key (it starts with fc-), or create a new one.",
      "Each page read uses Firecrawl credits from your plan.",
    ],
    keyHelpUrl: "https://docs.firecrawl.dev/introduction",
    readOps: [
      { method: "POST", path: "/scrape" },
      { method: "POST", path: "/map" },
      { method: "POST", path: "/search" },
    ],
    jobs: [
      {
        key: "read",
        title: "Read web pages",
        description: "Turn a page into clean text, list a site's pages, or search the web.",
        ops: [
          { method: "POST", path: "/scrape" },
          { method: "POST", path: "/map" },
          { method: "POST", path: "/search" },
        ],
      },
      {
        key: "crawl",
        title: "Crawl a whole site",
        description: "Start a crawl (waits for your approval, since it uses credits) and collect the results.",
        ops: [
          { method: "POST", path: "/crawl" },
          { method: "GET", path: "/crawl/{id}" },
          { method: "GET", path: "/team/credit-usage" },
        ],
      },
    ],
  },
  {
    key: "pdfco",
    name: "PDF.co",
    category: "AI & media",
    blurb: "Pull text and tables out of PDFs, or make PDFs.",
    source: { kind: "openapi_url", url: "https://developer.pdf.co/openapi.json" },
    auth: { type: "api_key", in: "header", name: "x-api-key" },
    keySteps: [
      "Sign in at app.pdf.co.",
      "Open the API section of your dashboard and copy your API key.",
      "Each conversion uses PDF.co credits from your plan.",
    ],
    keyHelpUrl: "https://docs.pdf.co/api-reference/authentication",
    readOps: [
      { method: "POST", path: "/v1/pdf/convert/to/text" },
      { method: "POST", path: "/v1/pdf/convert/to/csv" },
      { method: "POST", path: "/v1/pdf/convert/to/json2" },
      { method: "POST", path: "/v1/pdf/info" },
    ],
    jobs: [
      {
        key: "extract",
        title: "Read PDFs",
        description: "Get a PDF's text, tables or details from its link.",
        ops: [
          { method: "POST", path: "/v1/pdf/convert/to/text" },
          { method: "POST", path: "/v1/pdf/convert/to/csv" },
          { method: "POST", path: "/v1/pdf/convert/to/json2" },
          { method: "POST", path: "/v1/pdf/info" },
          { method: "GET", path: "/v1/account/credit/balance" },
        ],
      },
      {
        key: "make",
        title: "Make and merge PDFs",
        description: "Turn a web page or HTML into a PDF, or merge PDFs (each waits for your approval).",
        ops: [
          { method: "POST", path: "/v1/pdf/convert/from/url" },
          { method: "POST", path: "/v1/pdf/convert/from/html" },
          { method: "POST", path: "/v1/pdf/merge" },
        ],
      },
    ],
  },
  {
    key: "heygen",
    name: "HeyGen",
    category: "AI & media",
    blurb: "Make avatar videos from a script or a template.",
    source: { kind: "openapi_url", url: "https://developers.heygen.com/openapi/external-api.json" },
    auth: { type: "api_key", in: "header", name: "x-api-key" },
    keySteps: [
      "Sign in to HeyGen and open platform.heygen.com/api-keys.",
      "Click Generate (or Create API key) and copy the key.",
      "Videos use HeyGen credits from your plan, so making one waits for your approval.",
    ],
    keyHelpUrl: "https://developers.heygen.com/docs/api-key",
    jobs: [
      {
        key: "video",
        title: "Make an avatar video",
        description: "Pick an avatar and voice, make a video (waits for your approval) and check when it's ready.",
        ops: [
          { method: "GET", path: "/v3/avatars" },
          { method: "GET", path: "/v3/voices" },
          { method: "POST", path: "/v3/videos" },
          { method: "GET", path: "/v3/videos/{video_id}" },
        ],
      },
      {
        key: "template",
        title: "Video from a template",
        description: "Fill one of your templates to make a video (waits for your approval).",
        ops: [
          { method: "GET", path: "/v3/templates" },
          { method: "GET", path: "/v3/templates/{template_id}" },
          { method: "POST", path: "/v3/templates/{template_id}" },
          { method: "GET", path: "/v3/videos/{video_id}" },
        ],
      },
    ],
  },
  {
    key: "activecampaign",
    name: "ActiveCampaign",
    category: "Marketing",
    blurb: "Find and update contacts, tags, lists and deals.",
    source: { kind: "openapi_url", url: "https://developers.activecampaign.com/openapi/v3.json" },
    baseUrl: "https://{account}.api-us1.com/api/3",
    auth: { type: "api_key", in: "header", name: "Api-Token" },
    placeholders: {
      account: "Your account name: the part before .activehosted.com (or .api-us1.com) in the API URL shown next to your key. For acme.api-us1.com, it's acme.",
    },
    keySteps: [
      "In ActiveCampaign, click Settings (bottom left), then Developer.",
      "Copy the API URL (it shows your account name) and the API key.",
      "Each user has their own key, with that user's access.",
    ],
    keyHelpUrl: "https://developers.activecampaign.com/reference/authentication",
    jobs: [
      {
        key: "contacts",
        title: "Find and update contacts",
        description: "Look contacts up, and add or update them (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/contacts" },
          { method: "GET", path: "/contacts/{id}" },
          { method: "POST", path: "/contacts" },
          { method: "PUT", path: "/contacts/{id}" },
        ],
      },
      {
        key: "segment",
        title: "Tag contacts and add to lists",
        description: "Tag a contact or add it to a list (each waits for your approval).",
        ops: [
          { method: "GET", path: "/tags" },
          { method: "POST", path: "/contactTags" },
          { method: "GET", path: "/lists" },
          { method: "POST", path: "/contactLists" },
        ],
      },
      {
        key: "deals",
        title: "Work the deal pipeline",
        description: "See deals and create or update them (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/deals" },
          { method: "GET", path: "/deals/{id}" },
          { method: "POST", path: "/deals" },
          { method: "PUT", path: "/deals/{id}" },
        ],
      },
    ],
  },
  {
    key: "close",
    name: "Close",
    category: "Sales",
    blurb: "Look up leads, log notes and calls, and manage tasks.",
    source: { kind: "openapi_url", url: "https://developer.close.com/openapi.json" },
    auth: { type: "basic", username: "The API key", password: "Leave empty" },
    keySteps: [
      "In Close, open Settings, then Developer, then API Keys.",
      "Click New API Key, name it \"BYOMCP\", and copy it.",
      "Here, the username is the key and the password stays empty.",
    ],
    keyHelpUrl: "https://help.close.com/docs/api-keys-oauth",
    jobs: [
      {
        key: "leads",
        title: "Look up leads",
        description: "Find leads and their contacts, and see the pipeline.",
        ops: [
          { method: "GET", path: "/me/" },
          { method: "GET", path: "/lead/" },
          { method: "GET", path: "/lead/{id}/" },
          { method: "GET", path: "/contact/" },
          { method: "GET", path: "/opportunity/" },
        ],
      },
      {
        key: "activity",
        title: "Log notes, calls and tasks",
        description: "Add a note or call to a lead and create follow-up tasks (each waits for your approval).",
        ops: [
          { method: "GET", path: "/activity/note/" },
          { method: "POST", path: "/activity/note/" },
          { method: "POST", path: "/activity/call/" },
          { method: "GET", path: "/task/" },
          { method: "POST", path: "/task/" },
        ],
      },
    ],
  },
  {
    key: "instantly",
    name: "Instantly",
    category: "Sales",
    blurb: "Check cold-email campaigns, leads and replies.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/instantly.json" },
    baseUrl: "https://api.instantly.ai",
    auth: { type: "bearer" },
    keySteps: [
      "In Instantly, open Settings, then Integrations, then API Keys.",
      "Click Create API Key, name it \"BYOMCP\", and choose its scopes (read access is enough to start).",
      "Copy the key now: Instantly shows it only once.",
    ],
    keyHelpUrl: "https://developer.instantly.ai/getting-started/authorization",
    readOps: [{ method: "POST", path: "/api/v2/leads/list" }],
    jobs: [
      {
        key: "campaigns",
        title: "Report on campaigns",
        description: "See campaigns and their opens, replies and bounces.",
        ops: [
          { method: "GET", path: "/api/v2/campaigns" },
          { method: "GET", path: "/api/v2/campaigns/{id}" },
          { method: "GET", path: "/api/v2/campaigns/analytics" },
          { method: "GET", path: "/api/v2/campaigns/analytics/overview" },
        ],
      },
      {
        key: "leads",
        title: "Manage leads",
        description: "Find leads and add new ones (adding waits for your approval).",
        ops: [
          { method: "POST", path: "/api/v2/leads/list" },
          { method: "GET", path: "/api/v2/leads/{id}" },
          { method: "POST", path: "/api/v2/leads" },
        ],
      },
      {
        key: "inbox",
        title: "Answer replies",
        description: "Read replies and answer them (each email waits for your approval).",
        ops: [
          { method: "GET", path: "/api/v2/emails" },
          { method: "POST", path: "/api/v2/emails/reply" },
        ],
      },
    ],
  },
  {
    key: "apollo",
    name: "Apollo.io",
    category: "Sales",
    blurb: "Find prospects and companies, and enrich contacts.",
    source: { kind: "openapi_url", url: "https://docs.apollo.io/openapi/apollo-rest-api.json" },
    auth: { type: "api_key", in: "header", name: "x-api-key" },
    keySteps: [
      "In Apollo, open Settings, then Integrations, then API Keys.",
      "Click Create new key, name it \"BYOMCP\", and choose the endpoints it may use.",
      "Copy the key. Searches and enrichment use Apollo credits from your plan.",
    ],
    keyHelpUrl: "https://docs.apollo.io/docs/create-api-key",
    readOps: [
      { method: "POST", path: "/mixed_people/api_search" },
      { method: "POST", path: "/mixed_companies/search" },
      { method: "POST", path: "/contacts/search" },
    ],
    jobs: [
      {
        key: "prospect",
        title: "Find prospects",
        description: "Search people and companies that match your ideal customer.",
        ops: [
          { method: "GET", path: "/users/api_profile" },
          { method: "POST", path: "/mixed_people/api_search" },
          { method: "POST", path: "/mixed_companies/search" },
        ],
      },
      {
        key: "enrich",
        title: "Enrich a contact",
        description: "Fill in a person's or company's details (person lookups use credits, so they wait for your approval).",
        ops: [
          { method: "POST", path: "/people/match" },
          { method: "GET", path: "/organizations/enrich" },
        ],
      },
      {
        key: "crm",
        title: "Work your Apollo contacts",
        description: "Search your saved contacts and deals, and add contacts (adding waits for your approval).",
        ops: [
          { method: "POST", path: "/contacts/search" },
          { method: "GET", path: "/contacts/{contact_id}" },
          { method: "POST", path: "/contacts" },
          { method: "GET", path: "/opportunities/search" },
        ],
      },
    ],
  },
  {
    key: "flodesk",
    name: "Flodesk",
    category: "Marketing",
    blurb: "Manage subscribers, segments and email workflows.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/flodesk.json" },
    auth: { type: "basic", username: "The API key", password: "Leave empty" },
    keySteps: [
      "In Flodesk, open Account, then Integrations, then API.",
      "Click Create API key, name it \"BYOMCP\", and copy it.",
      "Here, the username is the key and the password stays empty.",
    ],
    keyHelpUrl: "https://help.flodesk.com/en/articles/8128775-about-api-keys",
    jobs: [
      {
        key: "subscribers",
        title: "Manage subscribers",
        description: "Find subscribers, and add or update them (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/subscribers" },
          { method: "GET", path: "/subscribers/{id_or_email}" },
          { method: "POST", path: "/subscribers" },
        ],
      },
      {
        key: "segments",
        title: "Segment and start workflows",
        description: "Add subscribers to segments or workflows (each waits for your approval).",
        ops: [
          { method: "GET", path: "/segments" },
          { method: "POST", path: "/subscribers/{id_or_email}/segments" },
          { method: "GET", path: "/workflows" },
          { method: "POST", path: "/workflows/{workflow_id}/subscribers" },
        ],
      },
    ],
  },
  {
    key: "typeform",
    name: "Typeform",
    category: "Productivity",
    blurb: "List forms and read their responses.",
    source: { kind: "docs_url", url: "https://www.typeform.com/developers/create/reference/retrieve-forms/" },
    baseUrl: "https://api.typeform.com",
    auth: { type: "bearer" },
    keySteps: [
      "In Typeform, open your account settings, then Personal tokens.",
      "Click Generate a new token, name it \"BYOMCP\", and choose forms:read, responses:read and workspaces:read.",
      "Copy the token now: Typeform shows it only once.",
    ],
    keyHelpUrl: "https://www.typeform.com/developers/get-started/personal-access-token/",
    jobs: [
      {
        key: "forms",
        title: "Read form responses",
        description: "List forms and read what people answered.",
        ops: [
          { method: "GET", path: "/forms" },
          { method: "GET", path: "/forms/{form_id}" },
          { method: "GET", path: "/forms/{form_id}/responses" },
        ],
      },
    ],
  },
  {
    key: "razorpay",
    name: "Razorpay",
    category: "Payments",
    blurb: "Look up orders, payments and refunds; create payment links.",
    source: { kind: "docs_url", url: "https://razorpay.com/docs/api/orders/" },
    baseUrl: "https://api.razorpay.com",
    auth: { type: "basic", username: "The Key ID (starts with rzp_test_ or rzp_live_)", password: "The Key Secret" },
    keySteps: [
      "In the Razorpay Dashboard, switch to Test Mode first.",
      "Open Account & Settings, then API Keys, and click Generate Key.",
      "Copy the Key ID and the Key Secret: the secret is shown only once.",
      "Here, the username is the Key ID and the password is the Key Secret.",
    ],
    keyHelpUrl: "https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/",
    adminNeeded: true,
    jobs: [
      {
        key: "orders",
        title: "Look up orders and payments",
        description: "Find orders, their payments and refunds.",
        ops: [
          { method: "GET", path: "/v1/orders" },
          { method: "GET", path: "/v1/orders/{id}" },
          { method: "GET", path: "/v1/orders/{id}/payments" },
          { method: "GET", path: "/v1/payments/{id}" },
        ],
      },
    ],
  },
  {
    key: "freshdesk",
    name: "Freshdesk",
    category: "Support",
    blurb: "Read, answer and update support tickets.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/freshdesk.yaml" },
    baseUrl: "https://{domain}.freshdesk.com",
    auth: { type: "basic", username: "Your API key", password: "X (the letter)" },
    placeholders: { domain: "Your helpdesk name: the part before .freshdesk.com. For acme.freshdesk.com, it's acme." },
    keySteps: [
      "In Freshdesk, click your profile picture, then Profile settings.",
      "Click View API key, complete the check, and copy the key.",
      "Here, the username is the key and the password is the letter X.",
      "The key has your agent access, so use an agent who can see the tickets it should handle.",
    ],
    keyHelpUrl: "https://support.freshdesk.com/support/solutions/articles/215517-how-to-find-your-api-key",
    jobs: [
      {
        key: "tickets",
        title: "Answer customer tickets",
        description: "See tickets, read the conversation, and reply or add a note (each waits for your approval).",
        ops: [
          { method: "GET", path: "/api/v2/tickets" },
          { method: "GET", path: "/api/v2/tickets/{id}" },
          { method: "GET", path: "/api/v2/tickets/{id}/conversations" },
          { method: "POST", path: "/api/v2/tickets/{id}/reply" },
          { method: "POST", path: "/api/v2/tickets/{id}/notes" },
        ],
      },
      {
        key: "triage",
        title: "Triage tickets",
        description: "Find tickets by status, priority or tag, and update them (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/api/v2/search/tickets" },
          { method: "PUT", path: "/api/v2/tickets/{id}" },
        ],
      },
      {
        key: "customers",
        title: "Find a customer's history",
        description: "Look up a contact and their tickets.",
        ops: [
          { method: "GET", path: "/api/v2/contacts" },
          { method: "GET", path: "/api/v2/contacts/{contact_id}" },
          { method: "GET", path: "/api/v2/tickets" },
        ],
      },
    ],
  },
  {
    key: "woocommerce",
    name: "WooCommerce",
    category: "Sales",
    blurb: "Look up orders, products and customers; update orders.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/woocommerce.yaml" },
    baseUrl: "https://{store}/wp-json/wc/v3",
    auth: { type: "basic", username: "The Consumer Key (starts with ck_)", password: "The Consumer Secret (starts with cs_)" },
    placeholders: { store: "Your store's web address without https://, for example shop.example.com." },
    keySteps: [
      "In WordPress, open WooCommerce, then Settings, then Advanced, then REST API.",
      "Click Add key, describe it as \"BYOMCP\", pick a user, and choose Read (or Read/Write to update orders).",
      "Click Generate API key and copy the Consumer Key and Consumer Secret: they're shown only once.",
      "Here, the username is the Consumer Key and the password is the Consumer Secret.",
    ],
    keyHelpUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    adminNeeded: true,
    jobs: [
      {
        key: "orders",
        title: "Help with orders",
        description: "Find an order and its notes, and update it or add a note (changes wait for your approval).",
        ops: [
          { method: "GET", path: "/orders" },
          { method: "GET", path: "/orders/{id}" },
          { method: "GET", path: "/orders/{order_id}/notes" },
          { method: "PUT", path: "/orders/{id}" },
          { method: "POST", path: "/orders/{order_id}/notes" },
        ],
      },
      {
        key: "catalog",
        title: "Look up products and customers",
        description: "Check products and stock, and find customers.",
        ops: [
          { method: "GET", path: "/products" },
          { method: "GET", path: "/products/{id}" },
          { method: "GET", path: "/customers" },
          { method: "GET", path: "/customers/{id}" },
        ],
      },
    ],
  },
  {
    key: "databricks",
    name: "Databricks",
    category: "Data",
    blurb: "Check jobs and clusters, run jobs, and query with SQL.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/databricks.yaml" },
    baseUrl: "https://{workspace}",
    auth: { type: "bearer" },
    placeholders: { workspace: "Your workspace address without https://, as in your browser, for example dbc-1234abcd-5678.cloud.databricks.com." },
    keySteps: [
      "In your Databricks workspace, click your username (top right), then Settings, then Developer.",
      "Next to Access tokens, click Manage, then Generate new token. Name it \"BYOMCP\" and set a lifetime.",
      "Copy the token now: Databricks shows it only once.",
      "If you can't create tokens, ask a workspace admin to allow personal access tokens.",
    ],
    keyHelpUrl: "https://docs.databricks.com/aws/en/dev-tools/auth/pat",
    adminNeeded: true,
    jobs: [
      {
        key: "jobs",
        title: "Monitor and run jobs",
        description: "See jobs and their recent runs, and start a run (waits for your approval).",
        ops: [
          { method: "GET", path: "/api/2.2/jobs/list" },
          { method: "GET", path: "/api/2.2/jobs/runs/list" },
          { method: "GET", path: "/api/2.2/jobs/runs/get" },
          { method: "POST", path: "/api/2.2/jobs/run-now" },
        ],
      },
      {
        key: "sql",
        title: "Answer questions with SQL",
        description: "Run SQL on a warehouse and read the result (each query waits for your approval).",
        ops: [
          { method: "GET", path: "/api/2.0/sql/warehouses" },
          { method: "POST", path: "/api/2.0/sql/statements" },
          { method: "GET", path: "/api/2.0/sql/statements/{statement_id}" },
        ],
      },
    ],
  },
  {
    key: "green-api",
    name: "GREEN-API (WhatsApp)",
    category: "Messaging",
    blurb: "Send and read WhatsApp messages from your number.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/green-api.yaml" },
    baseUrl: "https://{host}/waInstance{idInstance}",
    auth: { type: "api_key", in: "path", name: "apiTokenInstance" },
    placeholders: {
      host: "The apiUrl on your instance page, without https://, for example 1103.api.green-api.com.",
      idInstance: "The idInstance number on your instance page.",
    },
    keySteps: [
      "Sign in at console.green-api.com and create an instance (there's a free developer plan).",
      "Open the instance and scan the QR code with WhatsApp on your phone to link it.",
      "Copy apiUrl, idInstance and apiTokenInstance from the instance page.",
      "Here, the key is the apiTokenInstance. GREEN-API puts it in the web address; BYOMCP adds it for you, so your AI employee never sees it.",
    ],
    keyHelpUrl: "https://green-api.com/en/docs/before-start/",
    readOps: [
      { method: "POST", path: "/getChatHistory/{apiTokenInstance}" },
      { method: "POST", path: "/checkWhatsapp/{apiTokenInstance}" },
    ],
    jobs: [
      {
        key: "reply",
        title: "Answer WhatsApp messages",
        description: "See new messages, read a chat, and reply (each message waits for your approval).",
        ops: [
          { method: "GET", path: "/lastIncomingMessages/{apiTokenInstance}" },
          { method: "POST", path: "/getChatHistory/{apiTokenInstance}" },
          { method: "POST", path: "/sendMessage/{apiTokenInstance}" },
        ],
      },
      {
        key: "notify",
        title: "Send WhatsApp updates",
        description: "Check a number has WhatsApp and send it a message (waits for your approval).",
        ops: [
          { method: "GET", path: "/getStateInstance/{apiTokenInstance}" },
          { method: "POST", path: "/checkWhatsapp/{apiTokenInstance}" },
          { method: "POST", path: "/sendMessage/{apiTokenInstance}" },
          { method: "GET", path: "/lastOutgoingMessages/{apiTokenInstance}" },
        ],
      },
    ],
  },
  {
    key: "kaleyra",
    name: "Kaleyra",
    category: "Messaging",
    blurb: "Send SMS from your registered sender and check delivery.",
    source: { kind: "openapi_url", url: "https://byomcp.vercel.app/specs/kaleyra.yaml" },
    baseUrl: "https://api.{pod}.kaleyra.io",
    auth: { type: "api_key", in: "header", name: "api-key" },
    placeholders: { pod: "Your region, shown as API Domain next to your key: in (India), ap (Singapore) or eu (Europe)." },
    keySteps: [
      "Sign in at kaleyra.io and click Developers in the left menu, then API Keys.",
      "Create a key (or open the … menu next to one, then Edit).",
      "Copy the API Key, and note the SID and API Domain shown with it: your AI employee needs the SID for each message.",
    ],
    keyHelpUrl: "https://developers.kaleyra.io/docs/generating-an-api-key",
    adminNeeded: true,
    jobs: [
      {
        key: "sms",
        title: "Send SMS updates",
        description: "Send an SMS from a template or text (waits for your approval) and check the logs.",
        ops: [
          { method: "POST", path: "/v2/{sid}/messages" },
          { method: "GET", path: "/v1/{sid}/messages/logs" },
        ],
      },
    ],
  },
];

export function catalogApp(key: unknown): CatalogApp | null {
  return typeof key === "string" ? (CATALOG.find((a) => a.key === key) ?? null) : null;
}

/** The catalog entry an import came from (matched by its source URL), if any. */
export function catalogForSource(sourceRef: string | null | undefined): CatalogApp | null {
  if (!sourceRef) return null;
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return CATALOG.find((a) => norm(a.source.url) === norm(sourceRef)) ?? null;
}

/** "/api/v2/tickets/{ticket_id}" and "/api/v2/tickets/{id}" are the same operation. */
export function opKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}").replace(/\/+$/, "")}`;
}

const segments = (path: string) => opKey("GET", path).slice(4).split("/").filter(Boolean);

/**
 * Same operation, allowing for a prefix that one side keeps in the server
 * address: "/api/v1/employees/{id}" matches "/employees/{id}" when the base
 * address already ends in /api/v1. The shorter path must still name a resource,
 * and the extra prefix must be plain words: a base address never holds a
 * {parameter}, so "/subscribers" doesn't match "/workflows/{id}/subscribers".
 */
export function sameOperation(a: { method: string; path: string }, b: { method: string; path: string }): boolean {
  if (a.method.toUpperCase() !== b.method.toUpperCase()) return false;
  const [x, y] = [segments(a.path), segments(b.path)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.some((s) => s !== "{}")) return x.length === y.length;
  const prefix = long.slice(0, long.length - short.length);
  if (prefix.includes("{}")) return false;
  return short.every((s, i) => s === long[prefix.length + i]);
}

/**
 * Action ids for the chosen jobs (unmatched operations are skipped). An exact
 * match wins: the prefix allowance only applies when nothing matches exactly.
 */
export function jobActionIds(jobs: CatalogJob[], actions: { id: string; method: string; path: string }[]): string[] {
  const ids = new Set<string>();
  for (const o of jobs.flatMap((j) => j.ops)) {
    const exact = actions.filter((a) => opKey(a.method, a.path) === opKey(o.method, o.path));
    for (const a of exact.length ? exact : actions.filter((a) => sameOperation(o, a))) ids.add(a.id);
  }
  return actions.filter((a) => ids.has(a.id)).map((a) => a.id);
}

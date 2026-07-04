// Opt-in crash reporting (Sentry) — the privacy-first subset of the SDK, wired so the
// "No telemetry" promise stays true by default:
//   - OFF unless the user flips Settings → Crash reports (default off, disclosed like the updater)
//   - the Sentry code isn't even LOADED (dynamic import) until the user opts in
//   - errors only: no tracing, no session replay, no session pings, no logs
//   - no breadcrumbs at all — console/fetch crumbs could carry conversation content
//   - sendDefaultPii false + a scrubber that strips user/request/breadcrumbs from every event
// A report contains: the error + stack trace, app version, OS/browser info. Never chats,
// characters, prompts, files, or paths the app has touched.
import { appVersion } from './tauri'

// The project DSN (sentry.io → Settings → Projects → Client Keys). A DSN is public by design —
// it can only ingest events, not read anything. Empty string = feature disabled AND hidden.
const SENTRY_DSN: string = 'https://33ff82ffd3b807f3a96bdfa03a915294@o4511678138089472.ingest.us.sentry.io/4511678143266816'

/** Whether the app was built with crash reporting available (a DSN is baked in). */
export const crashReportsAvailable = SENTRY_DSN !== ''

type SentryModule = typeof import('@sentry/react')
let sentry: SentryModule | null = null

/** Strip anything that could identify the user or carry content — applied to EVERY event. */
export function scrubEvent<T extends { user?: unknown; request?: unknown; breadcrumbs?: unknown }>(event: T): T {
  delete event.user
  delete event.request
  delete event.breadcrumbs
  return event
}

/** Start reporting (the one place Sentry is initialized). Loads the SDK on demand. */
export async function startCrashReports(): Promise<void> {
  if (!crashReportsAvailable || sentry) return
  const version = await appVersion().catch(() => '')
  const mod = await import('@sentry/react')
  mod.init({
    dsn: SENTRY_DSN,
    release: version ? `aphelion@${version}` : undefined,
    sendDefaultPii: false,
    // Errors only. No tracing, no replay, no logs — and no session pings: session tracking is an
    // integration in Sentry v9+, and defaultIntegrations:false below means it's never installed.
    tracesSampleRate: 0,
    // A minimal integration set: capture unhandled errors/rejections and keep stacks readable.
    // Deliberately NO breadcrumbs / no fetch/console instrumentation.
    defaultIntegrations: false,
    integrations: [
      mod.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
      mod.linkedErrorsIntegration(),
      mod.dedupeIntegration(),
      mod.inboundFiltersIntegration(),
      mod.functionToStringIntegration(),
    ],
    beforeSend: (event) => scrubEvent(event),
  })
  sentry = mod
}

/** Stop reporting and drop the client (toggling off in Settings). */
export async function stopCrashReports(): Promise<void> {
  if (!sentry) return
  await sentry.close().catch(() => {})
  sentry = null
}

/** Manual capture for the crash screen (no-op unless reporting is on). */
export function reportCrash(error: unknown): void {
  sentry?.captureException(error)
}

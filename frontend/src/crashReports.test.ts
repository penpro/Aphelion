import { describe, it, expect } from 'vitest'
import { scrubEvent, crashReportsAvailable } from './crashReports'

describe('crash reports privacy', () => {
  it('scrubEvent strips user, request, and breadcrumbs but keeps the error itself', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      user: { ip_address: '1.2.3.4' },
      request: { url: 'tauri://localhost' },
      breadcrumbs: [{ message: 'user typed something private' }],
    }
    const out = scrubEvent(event)
    expect(out.user).toBeUndefined()
    expect(out.request).toBeUndefined()
    expect(out.breadcrumbs).toBeUndefined()
    expect(out.exception.values[0].value).toBe('boom')
  })

  it('the feature is disabled (and hidden) while no DSN is baked in', () => {
    // Flipping this to true requires pasting a real DSN into crashReports.ts —
    // the test documents that shipping without one means zero telemetry paths.
    expect(crashReportsAvailable).toBe(false)
  })
})

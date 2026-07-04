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

  it('crash reporting is available (DSN baked in) — site copy must disclose the opt-in', () => {
    // This flipped to true in v0.1.49 when the DSN landed. If it ever goes back to false
    // (DSN removed), hide the Settings toggle claims from the site copy again.
    expect(crashReportsAvailable).toBe(true)
  })
})

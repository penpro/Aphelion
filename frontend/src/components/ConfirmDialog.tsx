import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../util'

export type ConfirmOptions = {
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean // defaults to true (red confirm button); pass false for a neutral confirm
}

// Fail closed: with no provider the default resolves false, so a destructive action never runs.
const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false)

/** Promise-based confirmation. `const confirm = useConfirm(); if (await confirm({...})) doIt()`. */
export function useConfirm() {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setOpts(null)
  }, [])

  // Focus the safe (Cancel) button on open; Escape cancels. Capture phase so it wins over a
  // modal's own Escape handler when the confirmation opens on top of one.
  useEffect(() => {
    if (!opts) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        settle(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [opts, settle])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={opts.title ?? 'Confirm'}
          onClick={() => settle(false)}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">{opts.title ?? 'Are you sure?'}</h3>
            <div className="confirm-msg">{opts.message}</div>
            <div className="confirm-actions">
              <button ref={cancelRef} type="button" className="btn ghost" onClick={() => settle(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={cx('btn', opts.danger !== false && 'danger')}
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

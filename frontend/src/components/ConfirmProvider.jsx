import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmContext } from '../lib/confirm'
import './ConfirmProvider.css'

// App-wide replacement for window.confirm: the provider exposes a
// promise-returning confirm() through context and renders one styled dialog
// at a time. Callers just `await confirm({...})` and branch on the answer.
function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolverRef = useRef(null)
  const confirmButtonRef = useRef(null)

  const confirm = useCallback((options) => {
    const config = typeof options === 'string' ? { message: options } : (options || {})
    return new Promise((resolve) => {
      // A second confirm() while one is open replaces the first: the earlier
      // caller is answered "no" so no promise is ever left hanging.
      if (resolverRef.current) resolverRef.current(false)
      resolverRef.current = resolve
      setRequest(config)
    })
  }, [])

  const settle = useCallback((answer) => {
    setRequest(null)
    const resolve = resolverRef.current
    resolverRef.current = null
    if (resolve) resolve(answer)
  }, [])

  // Escape answers "no", and the confirm button takes focus so a coach can
  // answer the dialog without reaching for the mouse.
  useEffect(() => {
    if (!request) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    confirmButtonRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [request, settle])

  const tone = request?.tone === 'danger' ? 'danger' : 'default'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div
          className="confirm-backdrop"
          data-testid="confirm-backdrop"
          onClick={() => settle(false)}
        >
          <div
            className={`confirm-dialog confirm-dialog-${tone}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={request.message ? 'confirm-message' : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <span className={`confirm-badge confirm-badge-${tone}`} aria-hidden="true">
              {tone === 'danger' ? (
                <svg viewBox="0 0 24 24">
                  <path
                    d="M12 3.5 21 20H3L12 3.5Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path d="M12 10v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="17.4" r="1.15" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="17" r="1.15" fill="currentColor" />
                </svg>
              )}
            </span>

            <h2 id="confirm-title" className="confirm-title">
              {request.title || 'Are you sure?'}
            </h2>
            {request.message && (
              <p id="confirm-message" className="confirm-message">{request.message}</p>
            )}

            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => settle(false)}
              >
                {request.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                ref={confirmButtonRef}
                className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-gold'}`}
                onClick={() => settle(true)}
              >
                {request.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export default ConfirmProvider

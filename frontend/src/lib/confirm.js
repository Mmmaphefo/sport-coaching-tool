import { createContext, useContext } from 'react'

// Promise-based confirmation, so a page can `await confirm({...})` in the
// middle of an async handler instead of nesting callbacks around a state
// flag. ConfirmProvider renders the actual dialog; the context only carries
// the `confirm()` function.
export const ConfirmContext = createContext(null)

// Pages are also rendered on their own in tests, so a missing provider must
// degrade to the browser dialog rather than crash the page.
function fallbackConfirm(options) {
  const message = typeof options === 'string' ? options : (options?.message ?? '')
  return Promise.resolve(window.confirm(message))
}

export function useConfirm() {
  return useContext(ConfirmContext) || fallbackConfirm
}

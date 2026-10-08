// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import '@testing-library/jest-dom'

// ThemeToggle uses window.matchMedia — not available in jsdom
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  })
}

// localStorage may be a stub in some jsdom/Node versions (empty object without methods)
if (!window.localStorage || typeof window.localStorage.getItem !== 'function') {
  const store = {}
  window.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    get length() { return Object.keys(store).length },
    key: (index) => Object.keys(store)[index] || null,
  }
}

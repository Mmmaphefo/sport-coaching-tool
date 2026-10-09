const isTestEnv = process.env.NODE_ENV === 'test'

let clerkMiddleware, requireAuth, getAuth

if (isTestEnv) {
  clerkMiddleware = () => (req, res, next) => next()
  requireAuth = () => (req, res, next) => next()
  getAuth = (req) => ({
    userId: req.headers['x-test-clerk-user-id'] || 'test_clerk_user',
  })
} else {
  const clerk = require('@clerk/express')
  clerkMiddleware = clerk.clerkMiddleware
  getAuth = clerk.getAuth

  // Clerk's own requireAuth() answers an unauthenticated API call with a 302
  // redirect to "/" on the API host, which the browser follows and reports as
  // a confusing "Request failed with status 404". An API should answer 401
  // JSON instead, so the frontend can show a real "please sign in" message.
  // clerkMiddleware() must run first (it is registered globally in app.js).
  requireAuth = () => (req, res, next) => {
    let userId
    try {
      userId = getAuth(req)?.userId
    } catch (err) {
      return next(err)
    }
    if (!userId) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    }
    next()
  }
}

module.exports = { clerkMiddleware, requireAuth, getAuth }

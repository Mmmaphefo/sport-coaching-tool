// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
const express = require('express');

const router = express.Router();

// Unauthenticated on purpose: Render's deploy health check (render.yaml
// healthCheckPath) and the Gitea keepalive workflow
// (.gitea/workflows/backend-keepalive.yml) both call this without a token.
// The response is a constant, so there is nothing to protect — and the
// endpoint deliberately avoids the database so a pinger never depends on
// DB health just to prove the process is up.
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;

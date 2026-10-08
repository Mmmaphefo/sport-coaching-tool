# External Cron Setup for Render Free Tier

## Problem
Render's free tier sleeps after 15 minutes of inactivity. This causes:
- ~1 minute cold start on next request
- Background jobs (auto-complete events, reminders) stop running
- Poor user experience during demos

## Solution
Set up an external cron service to ping `/api/health` every 5 minutes to keep Render awake.

## Recommended Services

### Option 1: Cron-Job.org (Recommended)
1. Go to https://cron-job.org and sign up (free)
2. Click "Create Cronjob"
3. Configure:
   - **Title**: KickStat Health Ping
   - **URL**: `https://kickstat-api-i2rc.onrender.com/api/health`
   - **Schedule**: Every 5 minutes
   - **Method**: GET
4. Save and enable

### Option 2: UptimeRobot
1. Go to https://uptimerobot.com and sign up (free tier: 50 monitors)
2. Click "Add New Monitor"
3. Configure:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: KickStat API
   - **URL**: `https://kickstat-api-i2rc.onrender.com/api/health`
   - **Interval**: 5 minutes
4. Save

### Option 3: Better Stack (formerly Better Uptime)
1. Go to https://betterstack.com and sign up (free tier available)
2. Create a new monitor
3. Configure:
   - **URL**: `https://kickstat-api-i2rc.onrender.com/api/health`
   - **Check interval**: 5 minutes
4. Save

## Verification
After setup, check the logs:
```bash
curl https://kickstat-api-i2rc.onrender.com/api/health
```

Expected response:
```json
{"status":"ok","time":"..."}
```

## Notes
- The `/api/health` endpoint is lightweight and doesn't trigger database operations
- This keeps the Render service awake 24/7
- Free tier cron services are sufficient for this use case
- No code changes required - this is purely infrastructure

# Oslo Booking Monitor

Monitors [Oslo Radhus](https://booking.oslo.kommune.no) for wedding ceremony cancellations and sends a Slack notification when a slot opens up.

Wedding slots at Oslo Radhus fill up fast and rarely become available. This monitor polls the public booking API on a schedule and alerts you immediately when someone cancels, so you can grab the slot before it's gone.

## How it works

A single Vercel serverless function (`/api/check`) does the following:

1. Queries the Oslo kommune booking API for each target date
2. Checks if any time slots have `bookingAllowed: true` and `booked: false`
3. If a slot is available, sends a Slack message with the date, time, and a "Book Now" button
4. Returns a JSON summary of all checked dates

The function is triggered on a schedule via [cron-job.org](https://cron-job.org).

## Setup

### 1. Deploy to Vercel

```bash
vercel --prod
```

### 2. Add Slack webhook

Create a [Slack app](https://api.slack.com/apps) with an Incoming Webhook, then:

```bash
vercel env add SLACK_WEBHOOK_URL production
```

Redeploy after adding the env var:

```bash
vercel --prod
```

### 3. Schedule with cron-job.org

Create a cron job pointing to your deployment:

- **URL:** `https://your-project.vercel.app/api/check`
- **Method:** GET
- **Schedule:** Every 5 minutes (`*/5 * * * *`)

## Configuration

Target dates and the booking asset ID are defined at the top of `api/check.js`:

```js
const ASSET_ID = "c641abdd-6352-477b-8d34-d5b299922330";
const TARGET_DATES = [
  "2026-06-06",
  "2026-06-10",
  "2026-06-12",
  "2026-06-19",
  "2026-06-20",
  "2026-06-26",
];
```

To monitor different dates or a different venue, update these values and redeploy.

## API

### `GET /api/check`

Checks all target dates and returns availability status.

```json
{
  "checked": "2026-03-14T11:13:27.527Z",
  "duration": "1333ms",
  "dates": [
    { "date": "2026-06-06", "status": "full", "bookedCount": 16 },
    { "date": "2026-06-10", "status": "full", "bookedCount": 12 },
    { "date": "2026-06-12", "status": "available", "count": 1, "times": ["11:00"] }
  ],
  "notified": true
}
```

### `GET /api/test-slack`

Sends a test message to the configured Slack channel. Use this to verify your webhook is working.

## Logs

Function logs are available in the [Vercel dashboard](https://vercel.com) under your project's Runtime Logs.

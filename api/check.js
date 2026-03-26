import { kv } from "@vercel/kv";

const ASSET_ID = "c641abdd-6352-477b-8d34-d5b299922330";
const API_URL = "https://api.booking.oslo.kommune.no/api/schedule";
const BOOKING_URL = `https://booking.oslo.kommune.no/ressurs?ressurs=${ASSET_ID}`;
const TARGET_DATES = [
  "2026-06-06",
  "2026-06-10",
  "2026-06-12",
  "2026-06-19",
  "2026-06-20",
];

const NOTIFY_COOLDOWN_SECONDS = 3600; // 1 hour before re-notifying about the same availability

export default async function handler(req, res) {
  const start = Date.now();
  console.log("[check] Starting booking check", { dates: TARGET_DATES });

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    console.error("[check] SLACK_WEBHOOK_URL not configured");
    return res.status(500).json({ error: "SLACK_WEBHOOK_URL not configured" });
  }

  const results = [];
  const availableDates = [];

  const sortedDates = [...TARGET_DATES].sort();
  const fromDate = sortedDates[0];
  const toDate = sortedDates[sortedDates.length - 1];

  try {
    const response = await fetch(
      `${API_URL}?bookableAssetIds=${ASSET_ID}&fromInclusive=${fromDate}&toInclusive=${toDate}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "oslo-booking-monitor/1.0",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      console.error(`[check] API error: HTTP ${response.status}`);
      return res.status(502).json({ error: `API returned HTTP ${response.status}` });
    }

    const data = await response.json();

    for (const date of TARGET_DATES) {
      const slots = data?.timeslotsByDate?.[date];

      if (!slots) {
        console.warn(`[check] No schedule data for ${date}`);
        results.push({ date, status: "no_data" });
        continue;
      }

      const available = slots.filter((s) => s.bookingAllowed && !s.booked);
      const booked = slots.filter((s) => s.booked);

      if (available.length > 0) {
        const times = available.map((s) => s.startTime.slice(0, 5));
        console.log(`[check] AVAILABLE ${date}: ${times.join(", ")} (${available.length} slots)`);
        results.push({ date, status: "available", count: available.length, times });
        availableDates.push({ date, times });
      } else {
        console.log(`[check] Full ${date}: ${booked.length} booked`);
        results.push({ date, status: "full", bookedCount: booked.length });
      }
    }
  } catch (err) {
    console.error(`[check] API error:`, err.message);
    return res.status(502).json({ error: err.message });
  }

  let notified = false;

  if (availableDates.length > 0) {
    // Build a fingerprint of current availability to deduplicate notifications
    const fingerprint = availableDates
      .map((d) => `${d.date}:${d.times.join(",")}`)
      .sort()
      .join("|");

    // Check if we already notified about this exact availability recently
    const lastNotified = await kv.get("last-notified-fingerprint");

    if (lastNotified === fingerprint) {
      console.log("[check] Already notified about this availability, skipping Slack");
    } else {
      const details = availableDates
        .map((d) => `*${d.date}:* ${d.times.join(", ")}`)
        .join("\n");

      console.log(`[check] Sending Slack notification for ${availableDates.length} date(s)`);

      try {
        const slackRes = await fetch(slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "Wedding slot available at Oslo Radhus!",
                  emoji: true,
                },
              },
              {
                type: "section",
                text: { type: "mrkdwn", text: details },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Book Now", emoji: true },
                    url: BOOKING_URL,
                    style: "primary",
                  },
                ],
              },
            ],
          }),
        });
        console.log(`[check] Slack response: ${slackRes.status}`);

        // Store fingerprint with a cooldown so we don't re-notify for the same slots
        await kv.set("last-notified-fingerprint", fingerprint, { ex: NOTIFY_COOLDOWN_SECONDS });
        notified = true;
      } catch (err) {
        console.error("[check] Slack notification failed:", err.message);
      }
    }
  } else {
    // No availability — clear the fingerprint so we notify immediately if slots open up again
    await kv.del("last-notified-fingerprint");
  }

  const duration = Date.now() - start;
  console.log(`[check] Done in ${duration}ms — notified: ${notified}`);

  return res.status(200).json({
    checked: new Date().toISOString(),
    duration: `${duration}ms`,
    dates: results,
    notified,
  });
}

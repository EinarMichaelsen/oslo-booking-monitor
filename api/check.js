const ASSET_ID = "c641abdd-6352-477b-8d34-d5b299922330";
const API_URL = "https://api.booking.oslo.kommune.no/api/schedule";
const BOOKING_URL = `https://booking.oslo.kommune.no/ressurs?ressurs=${ASSET_ID}`;
const TARGET_DATES = [
  "2026-06-06",
  "2026-06-10",
  "2026-06-12",
  "2026-06-19",
  "2026-06-20",
  "2026-06-26",
];

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

  for (const date of TARGET_DATES) {
    try {
      const response = await fetch(
        `${API_URL}?bookableAssetIds=${ASSET_ID}&fromInclusive=${date}&toInclusive=${date}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!response.ok) {
        console.error(`[check] API error for ${date}: HTTP ${response.status}`);
        results.push({ date, status: "error", error: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();
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
    } catch (err) {
      console.error(`[check] Error checking ${date}:`, err.message);
      results.push({ date, status: "error", error: err.message });
    }
  }

  if (availableDates.length > 0) {
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
    } catch (err) {
      console.error("[check] Slack notification failed:", err.message);
    }
  }

  const duration = Date.now() - start;
  console.log(`[check] Done in ${duration}ms — notified: ${availableDates.length > 0}`);

  return res.status(200).json({
    checked: new Date().toISOString(),
    duration: `${duration}ms`,
    dates: results,
    notified: availableDates.length > 0,
  });
}

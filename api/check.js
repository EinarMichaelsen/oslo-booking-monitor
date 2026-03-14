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
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
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
        results.push({ date, status: "error", error: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();
      const slots = data?.timeslotsByDate?.[date];

      if (!slots) {
        results.push({ date, status: "no_data" });
        continue;
      }

      const available = slots.filter((s) => s.bookingAllowed && !s.booked);
      const booked = slots.filter((s) => s.booked);

      if (available.length > 0) {
        const times = available.map((s) => s.startTime.slice(0, 5));
        results.push({ date, status: "available", count: available.length, times });
        availableDates.push({ date, times });
      } else {
        results.push({ date, status: "full", bookedCount: booked.length });
      }
    } catch (err) {
      results.push({ date, status: "error", error: err.message });
    }
  }

  if (availableDates.length > 0) {
    const details = availableDates
      .map((d) => `*${d.date}:* ${d.times.join(", ")}`)
      .join("\n");

    await fetch(slackWebhookUrl, {
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
  }

  return res.status(200).json({
    checked: new Date().toISOString(),
    dates: results,
    notified: availableDates.length > 0,
  });
}

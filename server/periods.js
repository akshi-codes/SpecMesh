const DAY = 86400000;
const dayFormatters = new Map();
export function dayKey(value, timezone = "UTC") {
  let formatter = dayFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (dayFormatters.size >= 32)
      dayFormatters.delete(dayFormatters.keys().next().value);
    dayFormatters.set(timezone, formatter);
  }
  return formatter.format(new Date(value));
}
export function dateShift(day, days) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}
export function midnight(day, timezone) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    guess += target - wall;
  }
  return guess;
}
export function period(query = {}, now = Date.now()) {
  if (typeof query === "string") query = { range: query };
  const timezone = query.timezone || "UTC";
  try {
    dayKey(now, timezone);
  } catch {
    throw Object.assign(new Error("Invalid reporting timezone."), {
      statusCode: 400,
    });
  }
  const range = query.range || "30d",
    today = dayKey(now, timezone);
  let start,
    end = now,
    previousStart,
    previousEnd;
  if (range === "today" || range === "yesterday") {
    const day = range === "today" ? today : dateShift(today, -1);
    start = midnight(day, timezone);
    end = range === "today" ? now : midnight(today, timezone);
    previousStart = midnight(dateShift(day, -1), timezone);
    previousEnd =
      range === "today" ? Math.min(start, previousStart + end - start) : start;
  } else if (range === "week") {
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = dateShift(today, -weekday);
    start = midnight(monday, timezone);
    previousStart = midnight(dateShift(monday, -7), timezone);
    previousEnd = previousStart + end - start;
  } else if (range === "custom") {
    const valid = (d) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d || "") &&
      !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
      new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (!valid(query.from) || !valid(query.to) || query.from > query.to)
      throw Object.assign(new Error("Choose valid start and end dates."), {
        statusCode: 400,
      });
    start = midnight(query.from, timezone);
    end = Math.min(now, midnight(dateShift(query.to, 1), timezone));
    if (start >= end)
      throw Object.assign(
        new Error("The selected dates must include past usage."),
        { statusCode: 400 },
      );
  } else {
    const days = { "7d": 7, "30d": 30, "90d": 90, all: 36500 }[range];
    if (!days)
      throw Object.assign(new Error("Invalid date range."), {
        statusCode: 400,
      });
    start = now - days * DAY;
  }
  previousEnd ??= start;
  previousStart ??= previousEnd - (end - start);
  return {
    range,
    timezone,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    previousStart: new Date(previousStart).toISOString(),
    previousEnd: new Date(previousEnd).toISOString(),
    comparable: range !== "all",
  };
}

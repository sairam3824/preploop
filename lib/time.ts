export function getDayInTimezone(timezone: string, inputDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(inputDate);
}

export function hoursUntilMidnight(timezone: string, date = new Date()) {
  const nowInTz = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
  const midnight = new Date(nowInTz);
  midnight.setHours(24, 0, 0, 0);

  return Math.max(0, Math.ceil((midnight.getTime() - nowInTz.getTime()) / (60 * 60 * 1000)));
}

export function updateStreak(lastActiveDate: string | null, today: string, currentStreak: number) {
  if (!lastActiveDate) {
    return 1;
  }

  if (lastActiveDate === today) {
    return currentStreak;
  }

  const last = new Date(lastActiveDate);
  const now = new Date(today);
  const diffDays = Math.round((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    return currentStreak + 1;
  }

  if (diffDays > 1) {
    return 1;
  }

  return currentStreak;
}

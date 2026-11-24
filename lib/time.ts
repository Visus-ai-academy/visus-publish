/** Datas no fuso do cliente (tenants.timezone), sem biblioteca externa. */

function offsetMinutes(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60_000;
}

/** "2026-12-03" + "18:30" no fuso dado → instante UTC. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000; // ajusta perto de mudança de horário
  return new Date(guess);
}

/** Instante → { date: "YYYY-MM-DD", time: "HH:mm" } no fuso dado. */
export function utcToZoned(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Primeiro e último instante de um mês ("2026-12") no fuso dado. */
export function monthRange(month: string, timeZone: string) {
  const [y, m] = month.split("-").map(Number);
  const start = zonedToUtc(`${y}-${String(m).padStart(2, "0")}-01`, "00:00", timeZone);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = zonedToUtc(`${ny}-${String(nm).padStart(2, "0")}-01`, "00:00", timeZone);
  return { start, end };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Amanhã ("YYYY-MM-DD") no fuso dado. Fora do render para não violar a pureza do componente. */
export function tomorrowIn(timeZone: string) {
  return utcToZoned(new Date(Date.now() + 86_400_000), timeZone).date;
}

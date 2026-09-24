// 判定层：训放成绩的纯业务规则
// 负责分速/名次计算、未归巢判定、提醒、待定标记与申诉合议判定，不碰界面与存档。

export type Health = "健康" | "带伤" | "体弱" | "观察中";

export const HEALTH_OPTIONS: Health[] = ["健康", "带伤", "体弱", "观察中"];

/** 两位独立复核员：各自给“维持 / 改判”，互不可见各自结论前可修改 */
export const JUDGE_NAMES = ["复核员甲 · 裁判长", "复核员乙 · 仲裁委"] as const;

export interface Race {
  id: string;
  /** 场次名，如 2026秋训·第三站 */
  name: string;
  /** 训放地点 */
  location: string;
  /** 放飞距离（公里） */
  distance: number;
  /** 天气 */
  weather: string;
  /** 放飞时刻（datetime-local） */
  releaseAt: string;
}

export interface Entry {
  id: string;
  raceId: string;
  /** 足环号（同羽赛鸽跨场次复用同一足环号） */
  ring: string;
  owner: string;
  lineage: string;
  /** 归巢时刻；null 表示未归巢 */
  arrival: string | null;
  health: Health;
  note?: string;
}

export interface RankedRow {
  entry: Entry;
  raceId: string;
  /** 飞行分钟数 */
  minutes: number;
  /** 分速（米/分） */
  speed: number;
  /** 场内名次（并列同名次） */
  rank: number;
}

export type Band = "全部" | "短距离" | "中距离" | "长距离";
export const BANDS: Band[] = ["全部", "短距离", "中距离", "长距离"];

export function bandOf(distanceKm: number): Exclude<Band, "全部"> {
  if (distanceKm < 100) return "短距离";
  if (distanceKm <= 300) return "中距离";
  return "长距离";
}

export interface BoardFilter {
  band: Band;
  health: "" | Health;
  weather: string;
  pendingOnly: boolean;
  query: string;
}

export const emptyFilter: BoardFilter = {
  band: "全部",
  health: "",
  weather: "",
  pendingOnly: false,
  query: "",
};

// ---------- 申诉合议 ----------

export type Opinion = "" | "维持" | "改判";
export type AppealKind = "报时更正" | "健康备注";
export type AppealStatus = "未结" | "改判" | "维持";

export interface JudgeVote {
  name: string;
  opinion: Opinion;
  comment: string;
}

export interface AppealPatch {
  /** 更正后的归巢时刻；undefined 表示不涉及该项 */
  arrival?: string | null;
  health?: Health;
  note?: string;
}

export interface Appeal {
  id: string;
  createdAt: string;
  raceId: string;
  ring: string;
  kind: AppealKind;
  summary: string;
  /** 申请改判的新值（鸽主持报时或健康备注来问） */
  patch: AppealPatch;
  /** 两人分别给意见，两席都到齐才合议 */
  votes: [JudgeVote, JudgeVote];
  status: AppealStatus;
  closedAt?: string;
}

export const pendingKey = (raceId: string, ring: string): string =>
  `${raceId}|${ring}`;

/** 未结申诉涉及的“场次+足环”，用于标待定、停发证书 */
export function pendingKeySet(appeals: Appeal[]): Set<string> {
  const set = new Set<string>();
  for (const a of appeals) {
    if (a.status === "未结") set.add(pendingKey(a.raceId, a.ring));
  }
  return set;
}

/** 同羽同场只留一条未结申诉 */
export function openAppealExists(
  appeals: Appeal[],
  raceId: string,
  ring: string
): boolean {
  return appeals.some(
    (a) =>
      a.status === "未结" && a.raceId === raceId && a.ring === ring
  );
}

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function makeAppeal(input: {
  raceId: string;
  ring: string;
  kind: AppealKind;
  summary: string;
  patch: AppealPatch;
  now: string;
}): Appeal {
  return {
    id: uid("ap"),
    createdAt: input.now,
    raceId: input.raceId,
    ring: input.ring,
    kind: input.kind,
    summary: input.summary,
    patch: input.patch,
    status: "未结",
    votes: [
      { name: JUDGE_NAMES[0], opinion: "", comment: "" },
      { name: JUDGE_NAMES[1], opinion: "", comment: "" },
    ],
  };
}

export function withVote(
  appeal: Appeal,
  judgeIndex: 0 | 1,
  opinion: Opinion,
  comment: string
): Appeal {
  const votes = appeal.votes.map((v, i) =>
    i === judgeIndex ? { ...v, opinion, comment } : { ...v }
  ) as [JudgeVote, JudgeVote];
  return { ...appeal, votes };
}

/** 两席均判“改判”才改判；任一维持（或缺席）即未结/维持 */
export function verdictOf(appeal: Appeal): AppealStatus {
  const [a, b] = appeal.votes;
  if (!a.opinion || !b.opinion) return "未结";
  return a.opinion === "改判" && b.opinion === "改判" ? "改判" : "维持";
}

export function bothVoted(appeal: Appeal): boolean {
  return verdictOf(appeal) !== "未结";
}

/** 按改判新值更正赛鸽记录（不可变更新）；名次/提醒由派生计算重算 */
export function patchEntry(entry: Entry, patch: AppealPatch): Entry {
  return {
    ...entry,
    arrival: patch.arrival !== undefined ? patch.arrival : entry.arrival,
    health: patch.health ?? entry.health,
    note: patch.note !== undefined ? patch.note : entry.note,
  };
}

// ---------- 成绩计算 ----------

export function flightMinutes(
  releaseAt: string,
  arrival: string
): number | null {
  const r = Date.parse(releaseAt);
  const a = Date.parse(arrival);
  if (Number.isNaN(r) || Number.isNaN(a) || a < r) return null;
  return (a - r) / 60000;
}

export function speedMpm(distanceKm: number, minutes: number): number {
  return (distanceKm * 1000) / minutes;
}

/**
 * 速度榜：仅归巢（归巢时刻有效）赛鸽入榜，按场内分速降序；
 * 未归巢不进速度榜。同场并列同名次（1224 式）。
 */
export function buildRows(races: Race[], entries: Entry[]): RankedRow[] {
  const ordered = [...races].sort((a, b) =>
    a.releaseAt < b.releaseAt ? 1 : -1
  );
  const rows: RankedRow[] = [];
  for (const race of ordered) {
    const list = entries
      .filter((e) => e.raceId === race.id && e.arrival)
      .map((e) => ({
        entry: e,
        minutes: flightMinutes(race.releaseAt, e.arrival as string),
      }))
      .filter(
        (x): x is { entry: Entry; minutes: number } =>
          x.minutes !== null && x.minutes > 0
      )
      .sort((a, b) => a.minutes - b.minutes);

    let rank = 0;
    list.forEach((x, i) => {
      if (i === 0 || list[i - 1].minutes !== x.minutes) rank = i + 1;
      rows.push({
        entry: x.entry,
        raceId: race.id,
        minutes: x.minutes,
        speed: speedMpm(race.distance, x.minutes),
        rank,
      });
    });
  }
  return rows;
}

export function missingEntries(races: Race[], entries: Entry[]): Entry[] {
  const ids = new Set(races.map((r) => r.id));
  return entries.filter((e) => ids.has(e.raceId) && !e.arrival);
}

export interface Reminder {
  entry: Entry;
  race: Race;
  kind: "未归巢" | "健康异常";
  text: string;
}

/** 提醒随当前值派生：更正归巢/健康后自动按新值重算 */
export function buildReminders(
  races: Race[],
  entries: Entry[]
): Reminder[] {
  const raceMap = new Map(races.map((r) => [r.id, r]));
  const out: Reminder[] = [];
  for (const e of entries) {
    const race = raceMap.get(e.raceId);
    if (!race) continue;
    if (!e.arrival) {
      out.push({
        entry: e,
        race,
        kind: "未归巢",
        text: `${race.name}（${race.location} ${race.distance}km）尚未归巢，不进速度榜，请持续关注`,
      });
    } else if (e.health !== "健康") {
      out.push({
        entry: e,
        race,
        kind: "健康异常",
        text: `归巢健康状态为“${e.health}”${e.note ? `（${e.note}）` : ""}，建议复查`,
      });
    }
  }
  return out.sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "未归巢" ? -1 : 1
  );
}

/** 筛选同时作用于当前公示榜与历史留档，筛选跟随复核后的现值 */
export function rowMatches(
  row: RankedRow,
  race: Race,
  filter: BoardFilter,
  pending: Set<string>
): boolean {
  if (filter.band !== "全部" && bandOf(race.distance) !== filter.band)
    return false;
  if (filter.weather && race.weather !== filter.weather) return false;
  if (filter.health && row.entry.health !== filter.health) return false;
  if (filter.pendingOnly && !pending.has(pendingKey(row.raceId, row.entry.ring)))
    return false;
  const q = filter.query.trim().toLowerCase();
  if (q) {
    const hay = `${row.entry.ring} ${row.entry.owner} ${row.entry.lineage}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------- 展示格式化 ----------

const pad2 = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(s: string | null): string {
  if (!s) return "未归巢";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${pad2(m)}分` : `${m}分钟`;
}

// ---------- 初始数据（已公示的两场训放） ----------

export const seedRaces: Race[] = [
  {
    id: "race-2026-0914",
    name: "2026秋训·第二站",
    location: "原阳",
    distance: 80,
    weather: "多云",
    releaseAt: "2026-09-14T07:20",
  },
  {
    id: "race-2026-0920",
    name: "2026秋训·第三站",
    location: "新乡",
    distance: 120,
    weather: "晴",
    releaseAt: "2026-09-20T07:00",
  },
];

export const seedEntries: Entry[] = [
  { id: "e-b1", raceId: "race-2026-0914", ring: "CHN-24-001839", owner: "张维城", lineage: "詹森系", arrival: "2026-09-14T08:25", health: "健康" },
  { id: "e-b2", raceId: "race-2026-0914", ring: "CHN-25-010332", owner: "周明远", lineage: "胡本系", arrival: "2026-09-14T08:31", health: "健康" },
  { id: "e-b3", raceId: "race-2026-0914", ring: "CHN-24-002114", owner: "李克俭", lineage: "凡龙系", arrival: "2026-09-14T08:40", health: "观察中", note: "归巢稍疲，已喂电解质" },
  { id: "e-a1", raceId: "race-2026-0920", ring: "CHN-24-001839", owner: "张维城", lineage: "詹森系", arrival: "2026-09-20T08:42", health: "健康" },
  { id: "e-a2", raceId: "race-2026-0920", ring: "CHN-25-010788", owner: "陈守一", lineage: "戈马力系", arrival: "2026-09-20T08:55", health: "健康" },
  { id: "e-a3", raceId: "race-2026-0920", ring: "CHN-25-010332", owner: "周明远", lineage: "胡本系", arrival: "2026-09-20T09:10", health: "带伤", note: "右翼擦伤" },
  { id: "e-a4", raceId: "race-2026-0920", ring: "CHN-24-002114", owner: "李克俭", lineage: "凡龙系", arrival: "2026-09-20T09:26", health: "健康" },
  { id: "e-a5", raceId: "race-2026-0920", ring: "CHN-23-008771", owner: "孙伯涛", lineage: "凡龙系", arrival: null, health: "健康" },
  { id: "e-a6", raceId: "race-2026-0920", ring: "CHN-25-011205", owner: "赵启明", lineage: "詹森系", arrival: null, health: "健康" },
];

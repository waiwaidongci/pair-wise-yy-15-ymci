// 判定层：纯函数。只负责成绩计算、提醒、证书状态与申诉复核判定，不碰存储和界面。

export type Health = "健康" | "轻伤" | "重伤" | "异常";
export const HEALTH_VALUES: Health[] = ["健康", "轻伤", "重伤", "异常"];

export type ReviewerId = "A" | "B";
export const REVIEWER_NAME: Record<ReviewerId, string> = { A: "复核员甲", B: "复核员乙" };

export type Opinion = "维持" | "改判";
export type AppealStatus = "未结" | "改判" | "维持";

export type CertStatus = "可发" | "待定停发" | "健康暂缓" | "不入榜";

export interface RaceEvent {
  id: string;
  name: string;
  /** 司放地点 */
  location: string;
  /** 放飞距离（米） */
  distance: number;
  /** 天气 */
  weather: string;
  /** 司放时刻（本地时间字符串 YYYY-MM-DDTHH:mm） */
  releaseTime: string;
  createdAt: number;
}

export interface Entry {
  id: string;
  eventId: string;
  /** 足环号（同场唯一） */
  ring: string;
  owner: string;
  bloodline: string;
  /** 归巢时刻，null 表示未归巢 */
  homeTime: string | null;
  health: Health;
  note: string;
}

export interface EntryPatch {
  homeTime?: string | null;
  health?: Health;
  note?: string;
}

export interface BoardRow {
  entryId: string;
  ring: string;
  owner: string;
  bloodline: string;
  returned: boolean;
  homeTime: string | null;
  health: Health;
  note: string;
  /** 飞行时长（分钟），未归巢或时刻异常为 null */
  durationMin: number | null;
  /** 分速（米/分），未归巢或时刻异常为 null */
  speed: number | null;
  /** 名次，未归巢/异常不进速度榜则为 null */
  rank: number | null;
  /** 是否存在未结申诉 */
  pending: boolean;
  cert: CertStatus;
  reminders: string[];
}

export interface TrailItem {
  at: number;
  text: string;
}

export interface Appeal {
  id: string;
  eventId: string;
  entryId: string;
  ring: string;
  /** 申诉事由：鸽主拿报时或健康备注来问 */
  reason: "报时更正" | "健康备注" | "其他";
  detail: string;
  /** 鸽主要求的更正内容 */
  proposal: EntryPatch;
  status: AppealStatus;
  votes: Vote[];
  createdAt: number;
  resolvedAt?: number;
  trail: TrailItem[];
}

export interface Vote {
  reviewer: ReviewerId;
  opinion: Opinion;
  comment: string;
  at: number;
}

// ---------- 基础计算 ----------

/** 飞行时长（分钟）。归巢时刻早于司放时刻返回 null，视为报时异常。 */
export function flightMinutes(releaseTime: string, homeTime: string | null): number | null {
  if (!homeTime) return null;
  const ms = new Date(homeTime).getTime() - new Date(releaseTime).getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return ms / 60000;
}

/** 分速（米/分），保留两位由界面决定，这里给原始值。 */
export function calcSpeed(distanceM: number, minutes: number | null): number | null {
  if (minutes === null || minutes <= 0 || distanceM <= 0) return null;
  return distanceM / minutes;
}

function buildReminders(
  e: Entry,
  releaseTime: string,
  minutes: number | null,
  pending: boolean,
): string[] {
  const out: string[] = [];
  if (pending) out.push("申诉未结，名次待定，证书停发");
  if (!e.homeTime) {
    out.push("未归巢，不进速度榜");
    return out;
  }
  if (minutes === null) out.push("归巢时刻早于（或等于）司放时刻，报时异常，暂不入榜");
  if (e.health === "轻伤") out.push("轻伤备注，归巢后建议复检");
  if (e.health === "重伤") out.push("重伤记录，暂缓一切评定");
  if (e.health === "异常") out.push("健康/电子环异常，需核实后处理");
  return out;
}

function certFor(rank: number | null, health: Health, pending: boolean): CertStatus {
  if (pending) return "待定停发";
  if (rank === null) return "不入榜";
  if (health === "重伤" || health === "异常") return "健康暂缓";
  return "可发";
}

/**
 * 算榜：登记地点/距离/天气在 event 上，归巢时刻与健康状态在 entry 上。
 * 未归巢（含报时异常）不进速度榜；有未结申诉的羽数标待定、停发证书。
 * 名次采用标准竞赛排名（并列同名次，随后跳过）。
 */
export function computeBoard(event: RaceEvent, entries: Entry[], pendingIds: Set<string>): BoardRow[] {
  const rows: BoardRow[] = entries
    .filter((e) => e.eventId === event.id)
    .map((e) => {
      const returned = e.homeTime !== null;
      const minutes = flightMinutes(event.releaseTime, e.homeTime);
      const speed = calcSpeed(event.distance, minutes);
      const pending = pendingIds.has(e.id);
      return {
        entryId: e.id,
        ring: e.ring,
        owner: e.owner,
        bloodline: e.bloodline,
        returned,
        homeTime: e.homeTime,
        health: e.health,
        note: e.note,
        durationMin: minutes,
        speed,
        rank: null as number | null,
        pending,
        cert: "不入榜" as CertStatus,
        reminders: buildReminders(e, event.releaseTime, minutes, pending),
      };
    });

  const ranked = rows
    .filter((r) => r.returned && r.speed !== null)
    .sort((a, b) => (b.speed as number) - (a.speed as number));

  ranked.forEach((r, i) => {
    if (i === 0) {
      r.rank = 1;
    } else {
      const prev = ranked[i - 1];
      r.rank = (r.speed as number) === (prev.speed as number) ? prev.rank : i + 1;
    }
  });

  rows.forEach((r) => {
    r.cert = certFor(r.rank, r.health, r.pending);
  });

  // 榜面顺序：名次在前，未归巢/异常殿后
  rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.ring.localeCompare(b.ring);
  });
  return rows;
}

// ---------- 申诉判定 ----------

/** 同羽同场只留一条未结申诉。 */
export function hasOpenAppeal(appeals: Appeal[], eventId: string, entryId: string): boolean {
  return appeals.some((a) => a.eventId === eventId && a.entryId === entryId && a.status === "未结");
}

export function canVote(appeal: Appeal, reviewer: ReviewerId): boolean {
  return appeal.status === "未结" && !appeal.votes.some((v) => v.reviewer === reviewer);
}

/**
 * 两人分别给“维持/改判”意见，任一一方已投后意见封存，双方都投才出结论：
 * 两人均改判 => 改判（由存档层应用 proposal 更新成绩）；否则维持原榜。
 */
export function castVote(
  appeal: Appeal,
  reviewer: ReviewerId,
  opinion: Opinion,
  comment: string,
  now: number,
): Appeal {
  if (!canVote(appeal, reviewer)) {
    throw new Error(`${REVIEWER_NAME[reviewer]}已提交意见，不能重复投票`);
  }
  const votes = [...appeal.votes, { reviewer, opinion, comment, at: now }];
  const trail = [...appeal.trail, { at: now, text: `${REVIEWER_NAME[reviewer]}提交意见：${opinion}` }];

  if (votes.length < 2) {
    return { ...appeal, votes, trail };
  }

  const uphold = votes.every((v) => v.opinion === "改判");
  const status: AppealStatus = uphold ? "改判" : "维持";
  trail.push({
    at: now,
    text: uphold
      ? "两人均判改判，申诉成立，按申请内容更正成绩并留档旧版"
      : "未达成两人均改判，申诉驳回，维持原榜",
  });
  return { ...appeal, votes, trail, status, resolvedAt: now };
}

/** 申诉是否成立到需要真正改数据。 */
export function shouldApplyProposal(appeal: Appeal): boolean {
  return appeal.status === "改判";
}

/** 把申请内容描述成可读差异，供复核台与档案使用。 */
export function describePatch(entry: Entry, patch: EntryPatch): string[] {
  const diffs: string[] = [];
  if (patch.homeTime !== undefined) {
    diffs.push(`归巢时刻：${entry.homeTime ?? "未归巢"} → ${patch.homeTime ?? "未归巢"}`);
  }
  if (patch.health !== undefined && patch.health !== entry.health) {
    diffs.push(`健康状态：${entry.health} → ${patch.health}`);
  }
  if (patch.note !== undefined && patch.note !== entry.note) {
    diffs.push(`备注：${entry.note || "（空）"} → ${patch.note || "（空）"}`);
  }
  return diffs;
}

// ---------- 档案对比 ----------

export interface RankChange {
  before: number | null;
  after: number | null;
  speedBefore: number | null;
  speedAfter: number | null;
}

/** 相邻两版榜对比：同名次/分速变化，供旧版留档时展示名次升降。 */
export function compareBoards(before: BoardRow[], after: BoardRow[]): Map<string, RankChange> {
  const map = new Map<string, RankChange>();
  for (const r of before) {
    map.set(r.ring, { before: r.rank, after: null, speedBefore: r.speed, speedAfter: null });
  }
  for (const r of after) {
    const prev = map.get(r.ring);
    map.set(r.ring, {
      before: prev?.before ?? null,
      after: r.rank,
      speedBefore: prev?.speedBefore ?? null,
      speedAfter: r.speed,
    });
  }
  return map;
}

// ---------- 录入校验 ----------

export function validateEntry(
  event: RaceEvent,
  entries: Entry[],
  input: { ring: string; homeTime: string | null },
  selfId?: string,
): string | null {
  const ring = input.ring.trim();
  if (!ring) return "足环号不能为空";
  if (entries.some((e) => e.eventId === event.id && e.ring === ring && e.id !== selfId)) {
    return `足环号 ${ring} 在本场已登记，同场不能重复`;
  }
  if (input.homeTime !== null && input.homeTime <= event.releaseTime) {
    return "归巢时刻早于或等于司放时刻，请核对报时";
  }
  return null;
}

export function formatDuration(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${String(m).padStart(2, "0")}分` : `${m}分`;
}

export function formatSpeed(speed: number | null): string {
  return speed === null ? "—" : speed.toFixed(1);
}

export function formatClock(iso: string | null): string {
  return iso ? iso.replace("T", " ") : "—";
}

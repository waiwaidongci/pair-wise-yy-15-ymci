// 存档层：赛事、登记、申诉、榜次版本的唯一数据源。
// 判定一律委托给 judging.ts；本文件只管存取、留档与操作轨迹。

import {
  Appeal,
  BoardRow,
  Entry,
  EntryPatch,
  Health,
  RaceEvent,
  ReviewerId,
  Opinion,
  computeBoard,
  castVote,
  hasOpenAppeal,
  shouldApplyProposal,
  validateEntry,
} from "./judging";

export interface BoardVersion {
  id: string;
  eventId: string;
  /** 建档时刻（epoch ms） */
  at: number;
  /** 留档原因 */
  reason: string;
  /** 关联的申诉（如有） */
  appealId?: string;
  /** 该版生效时的赛事与登记快照 */
  event: RaceEvent;
  entries: Entry[];
  /** 该版榜面（已算好，供档案页直接展示） */
  board: BoardRow[];
}

export interface StoreState {
  events: RaceEvent[];
  entries: Entry[];
  appeals: Appeal[];
  versions: BoardVersion[];
  seq: number;
}

const STORAGE_KEY = "pigeon-review-desk-v1";

type Listener = () => void;

function load(): StoreState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoreState) : null;
  } catch {
    return null;
  }
}

function save(state: StoreState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式等场景下落空即可 */
  }
}

// ---------- 演示数据 ----------

const D = "2026-09-24";
const event0: RaceEvent = {
  id: "ev1",
  name: "秋训第三站 · 郑州北",
  location: "郑州北司放点",
  distance: 300000,
  weather: "晴，西北风 2 级",
  releaseTime: `${D}T06:00`,
  createdAt: Date.parse(`${D}T06:00`) - 10 * 3600_000,
};

interface SeedInput {
  ring: string;
  owner: string;
  bloodline: string;
  home: string | null;
  health: Health;
  note: string;
}

const seedInputs: SeedInput[] = [
  { ring: "CHN-24-001102", owner: "李振东", bloodline: "詹森系", home: `${D}T11:38`, health: "健康", note: "" },
  { ring: "CHN-24-002114", owner: "王雅琴", bloodline: "凡龙系", home: `${D}T11:46`, health: "健康", note: "" },
  { ring: "CHN-24-001839", owner: "赵鸣", bloodline: "盖比系", home: `${D}T11:32`, health: "健康", note: "" },
  { ring: "CHN-24-003520", owner: "赵鸣", bloodline: "胡本系", home: `${D}T12:02`, health: "健康", note: "" },
  { ring: "CHN-24-001847", owner: "陈守义", bloodline: "杨阿滕系", home: `${D}T12:09`, health: "健康", note: "" },
  { ring: "CHN-23-008771", owner: "陈守义", bloodline: "考夫曼系", home: `${D}T12:25`, health: "轻伤", note: "右翼轻度擦伤，已消毒" },
  { ring: "CHN-24-004058", owner: "李振东", bloodline: "慕利门系", home: null, health: "异常", note: "开笼后脱离大群，截至当日 18:00 未归" },
  { ring: "CHN-24-004203", owner: "王雅琴", bloodline: "英格斯系", home: `${D}T12:40`, health: "重伤", note: "归巢即瘫，疑撞伤，已隔离观察" },
];

function buildSeed(): StoreState {
  const entries: Entry[] = seedInputs.map((s, i) => ({
    id: `e${i + 1}`,
    eventId: event0.id,
    ring: s.ring,
    owner: s.owner,
    bloodline: s.bloodline,
    homeTime: s.home,
    health: s.health,
    note: s.note,
  }));

  const e3 = entries[2]; // 001839：报时更正成立，3 → 1
  const e4 = entries[3]; // 003520：未结申诉

  // V1：初榜（e3 当时记录为 11:32）
  const v1Entries = entries.map((e) =>
    e.id === e3.id ? { ...e, homeTime: `${D}T11:52`, note: "" } : e,
  );
  const tPublish = Date.parse(`${D}T14:40`);
  const v1: BoardVersion = {
    id: "v1",
    eventId: event0.id,
    at: tPublish,
    reason: "初榜公示",
    event: { ...event0 },
    entries: v1Entries,
    board: computeBoard(event0, v1Entries, new Set()),
  };

  const appealClosed: Appeal = {
    id: "ap1",
    eventId: event0.id,
    entryId: e3.id,
    ring: e3.ring,
    reason: "报时更正",
    detail: "鸽主持鸽钟打印条称实际归巢 11:26，电子环上传延迟 26 分钟。",
    proposal: { homeTime: `${D}T11:26`, note: "经鸽钟条与电子环双记录核实，更正归巢时刻为 11:26" },
    status: "改判",
    votes: [
      { reviewer: "A", opinion: "改判", comment: "鸽钟条时间连续、封环完好，采信。", at: Date.parse(`${D}T15:10`) },
      { reviewer: "B", opinion: "改判", comment: "电子环日志确有上传延迟，同意更正。", at: Date.parse(`${D}T15:40`) },
    ],
    createdAt: Date.parse(`${D}T14:50`),
    resolvedAt: Date.parse(`${D}T15:40`),
    trail: [
      { at: Date.parse(`${D}T14:50`), text: "鸽主提交报时更正申诉（归巢时刻 11:52 → 11:26）" },
      { at: Date.parse(`${D}T15:10`), text: "复核员甲提交意见：改判" },
      { at: Date.parse(`${D}T15:40`), text: "复核员乙提交意见：改判" },
      { at: Date.parse(`${D}T15:40`), text: "两人均判改判，申诉成立，按申请内容更正成绩并留档旧版" },
    ],
  };

  const tV2 = Date.parse(`${D}T16:20`);
  const v2: BoardVersion = {
    id: "v2",
    eventId: event0.id,
    at: tV2,
    reason: "申诉改判：报时更正",
    appealId: appealClosed.id,
    event: { ...event0 },
    entries: entries.map((e) => ({ ...e })),
    // 此时 e4 的未结申诉已在 15:00 提出，V2 榜面该羽标待定
    board: computeBoard(event0, entries, new Set([e4.id])),
  };

  const appealOpen: Appeal = {
    id: "ap2",
    eventId: event0.id,
    entryId: e4.id,
    ring: e4.ring,
    reason: "报时更正",
    detail: "鸽主称鸽钟显示 10:20 归巢，报到时被排队耽误，申请按鸽钟时间更正。",
    proposal: { homeTime: `${D}T10:20` },
    status: "未结",
    votes: [],
    createdAt: Date.parse(`${D}T15:00`),
    trail: [{ at: Date.parse(`${D}T15:00`), text: "鸽主提交报时更正申诉（归巢时刻 12:02 → 10:20），等待两人复核" }],
  };

  return {
    events: [{ ...event0 }],
    entries,
    appeals: [appealClosed, appealOpen],
    versions: [v1, v2],
    seq: 100,
  };
}

// ---------- Store ----------

class Store {
  private state: StoreState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = load() ?? buildSeed();
  }

  getState = (): StoreState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    save(this.state);
    this.listeners.forEach((fn) => fn());
  }

  private nextId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}${this.state.seq}`;
  }

  // ----- 读取 -----

  getEvent(eventId: string): RaceEvent {
    const ev = this.state.events.find((e) => e.id === eventId);
    if (!ev) throw new Error("赛事不存在");
    return ev;
  }

  getEntry(entryId: string): Entry {
    const en = this.state.entries.find((e) => e.id === entryId);
    if (!en) throw new Error("登记记录不存在");
    return en;
  }

  pendingEntryIds(eventId: string, at?: number): Set<string> {
    return new Set(
      this.state.appeals
        .filter(
          (a) =>
            a.eventId === eventId &&
            a.status === "未结" &&
            (at === undefined || a.createdAt <= at),
        )
        .map((a) => a.entryId),
    );
  }

  /** 当前榜：按最新登记值现算。 */
  currentBoard(eventId: string): { event: RaceEvent; board: BoardRow[] } {
    const event = this.getEvent(eventId);
    const entries = this.state.entries.filter((e) => e.eventId === eventId);
    return { event, board: computeBoard(event, entries, this.pendingEntryIds(eventId)) };
  }

  versionsOf(eventId: string): BoardVersion[] {
    return this.state.versions.filter((v) => v.eventId === eventId).sort((a, b) => a.at - b.at);
  }

  appealsOf(eventId: string): Appeal[] {
    return this.state.appeals
      .filter((a) => a.eventId === eventId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ----- 留档：在数据变更前拍下旧版 -----

  private archive(eventId: string, reason: string, now: number, appealId?: string) {
    const event = this.getEvent(eventId);
    const entries = this.state.entries.filter((e) => e.eventId === eventId).map((e) => ({ ...e }));
    this.state.versions.push({
      id: this.nextId("v"),
      eventId,
      at: now,
      reason,
      appealId,
      event: { ...event },
      entries,
      board: computeBoard(event, entries, this.pendingEntryIds(eventId, now)),
    });
  }

  private ensurePublished(eventId: string, now: number) {
    if (!this.state.versions.some((v) => v.eventId === eventId)) {
      this.archive(eventId, "初榜公示", now);
    }
  }

  // ----- 赛事与登记 -----

  addEvent(input: Omit<RaceEvent, "id" | "createdAt">): string {
    const now = Date.now();
    const id = this.nextId("ev");
    this.state.events.push({ ...input, id, createdAt: now });
    this.emit();
    return id;
  }

  /** 更正赛事地点 / 距离 / 天气等：名次分速按新值重算，旧版留档。 */
  updateEventMeta(eventId: string, patch: Partial<Omit<RaceEvent, "id" | "createdAt">>) {
    const now = Date.now();
    this.ensurePublished(eventId, now);
    this.archive(eventId, "赛事信息更正（地点/距离/天气/司放时刻）", now);
    const ev = this.getEvent(eventId);
    Object.assign(ev, patch);
    this.emit();
  }

  addEntry(eventId: string, input: Omit<Entry, "id" | "eventId">): string {
    const now = Date.now();
    const event = this.getEvent(eventId);
    const err = validateEntry(event, this.state.entries, {
      ring: input.ring,
      homeTime: input.homeTime,
    });
    if (err) throw new Error(err);

    const hadVersion = this.state.versions.some((v) => v.eventId === eventId);
    // 已公示过：改动前先留旧版；首条登记则在加入后生成初榜，避免空版留档
    if (hadVersion) this.archive(eventId, `新增登记：${input.ring.trim()}`, now);

    const id = this.nextId("e");
    this.state.entries.push({ ...input, id, eventId });

    if (!hadVersion) this.archive(eventId, "初榜公示", now);
    this.emit();
    return id;
  }

  /** 登记台更正（鸽主报时/健康备注核实后由记录员直接改）：重算并留档。 */
  updateEntry(entryId: string, patch: EntryPatch, reason: string) {
    const now = Date.now();
    const entry = this.getEntry(entryId);
    const event = this.getEvent(entry.eventId);
    const err = validateEntry(
      event,
      this.state.entries,
      { ring: entry.ring, homeTime: patch.homeTime ?? entry.homeTime },
      entry.id,
    );
    if (err) throw new Error(err);
    this.archive(entry.eventId, `登记更正：${entry.ring}（${reason}）`, now);
    Object.assign(entry, patch);
    this.emit();
  }

  // ----- 申诉 -----

  openAppeal(
    eventId: string,
    entryId: string,
    reason: Appeal["reason"],
    detail: string,
    proposal: EntryPatch,
  ): string {
    const now = Date.now();
    if (hasOpenAppeal(this.state.appeals, eventId, entryId)) {
      throw new Error("该羽本场已有一条未结申诉，同羽同场只留一条");
    }
    const entry = this.getEntry(entryId);
    const id = this.nextId("ap");
    this.state.appeals.push({
      id,
      eventId,
      entryId,
      ring: entry.ring,
      reason,
      detail,
      proposal,
      status: "未结",
      votes: [],
      createdAt: now,
      trail: [{ at: now, text: `鸽主提交${reason}申诉，等待两人复核` }],
    });
    this.emit();
    return id;
  }

  vote(eventId: string, appealId: string, reviewer: ReviewerId, opinion: Opinion, comment: string) {
    const now = Date.now();
    const appeal = this.state.appeals.find((a) => a.id === appealId && a.eventId === eventId);
    if (!appeal) throw new Error("申诉不存在");

    const updated = castVote(appeal, reviewer, opinion, comment, now);
    Object.assign(appeal, updated);

    // 两人都判改判才更新成绩；先留旧版再应用申请内容。
    if (shouldApplyProposal(appeal)) {
      this.archive(eventId, `申诉改判：${appeal.reason}`, now, appeal.id);
      const entry = this.getEntry(appeal.entryId);
      Object.assign(entry, appeal.proposal);
    }
    this.emit();
  }

  resetDemo() {
    this.state = buildSeed();
    this.emit();
  }
}

export const store = new Store();

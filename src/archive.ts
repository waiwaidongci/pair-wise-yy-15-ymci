// 存档层：公示榜版本快照
// 公示初榜留 v1；两人合议改判时，落版前先把旧榜快照存下，旧版永久留档可查。

import {
  Appeal,
  Entry,
  Race,
  RankedRow,
  buildRows,
  pendingKeySet,
} from "./judge";

export interface BoardVersion {
  id: string;
  raceId: string;
  /** v1 为公示初榜；v2 起为复核改判后落版 */
  version: number;
  title: string;
  /** 快照落档时刻 */
  archivedAt: string;
  note: string;
  /** 该版本落版瞬间的入榜名次（未归巢不入榜） */
  rows: RankedRow[];
  /** 该版本下未结申诉涉及的“场次|足环”，旧榜按当时状态显示待定 */
  pendingKeys: string[];
}

let archiveSeq = 0;
function archiveId(): string {
  archiveSeq += 1;
  return `ver-${Date.now().toString(36)}-${archiveSeq.toString(36)}`;
}

/** 某场次当前版本号：无留档表示尚未公示 */
export function latestVersion(
  archive: BoardVersion[],
  raceId: string
): BoardVersion | null {
  const list = archive
    .filter((v) => v.raceId === raceId)
    .sort((a, b) => b.version - a.version);
  return list[0] ?? null;
}

function snapshot(
  version: number,
  race: Race,
  rows: RankedRow[],
  pending: Set<string>,
  archivedAt: string,
  title: string,
  note: string
): BoardVersion {
  return {
    id: archiveId(),
    raceId: race.id,
    version,
    title,
    archivedAt,
    note,
    rows: rows
      .filter((r) => r.raceId === race.id)
      .map((r) => structuredClone(r)),
    pendingKeys: [...pending].filter((k) => k.startsWith(`${race.id}|`)),
  };
}

/** 登记完成后首次公示：留存初榜 v1 */
export function archiveInitialBoard(
  archive: BoardVersion[],
  race: Race,
  entries: Entry[],
  appeals: Appeal[],
  archivedAt: string
): { archive: BoardVersion[]; version: BoardVersion } {
  if (latestVersion(archive, race.id)) {
    throw new Error("该场次已公示，不能重复建立初榜");
  }
  const rows = buildRows([race], entries);
  const version = snapshot(
    1,
    race,
    rows,
    pendingKeySet(appeals),
    archivedAt,
    "公示初榜 v1",
    "贴榜公示：鸽主可持报时或健康备注发起申诉",
  );
  return { archive: [...archive, version], version };
}

/**
 * 改判落版：先把旧版原样留档（其实旧版此前已在库，这里补存落版前一刻的榜面），
 * 再按更正后的现值生成新版本。名次、分速由新值重算。
 */
export function archiveRevision(
  archive: BoardVersion[],
  race: Race,
  entries: Entry[],
  appeals: Appeal[],
  archivedAt: string,
  changeNote: string
): { archive: BoardVersion[]; version: BoardVersion } {
  const prev = latestVersion(archive, race.id);
  if (!prev) {
    throw new Error("该场次尚未公示，不能产生复核改判版");
  }
  const rows = buildRows([race], entries);
  const nextNo = prev.version + 1;
  const version = snapshot(
    nextNo,
    race,
    rows,
    pendingKeySet(appeals),
    archivedAt,
    `复核改判 v${nextNo}`,
    changeNote,
  );
  return { archive: [...archive, version], version };
}

/** 初榜快照（用于初始数据，尚未有申诉，榜单无待定） */
export function seedInitialVersion(
  race: Race,
  entries: Entry[],
  archivedAt: string
): BoardVersion {
  return snapshot(
    1,
    race,
    buildRows([race], entries),
    new Set<string>(),
    archivedAt,
    "公示初榜 v1",
    "贴榜公示：鸽主可持报时或健康备注发起申诉",
  );
}

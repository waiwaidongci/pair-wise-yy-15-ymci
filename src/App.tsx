import { useMemo, useState } from "react";
import "./styles.css";
import {
  Appeal,
  AppealKind,
  Band,
  BANDS,
  BoardFilter,
  Entry,
  HEALTH_OPTIONS,
  Health,
  JUDGE_NAMES,
  Race,
  RankedRow,
  bothVoted,
  buildReminders,
  buildRows,
  emptyFilter,
  fmtDateTime,
  fmtMinutes,
  makeAppeal,
  missingEntries,
  openAppealExists,
  bandOf,
  patchEntry,
  pendingKey,
  pendingKeySet,
  rowMatches,
  seedEntries,
  seedRaces,
  withVote,
} from "./judge";
import {
  BoardVersion,
  archiveInitialBoard,
  archiveRevision,
  latestVersion,
  seedInitialVersion,
} from "./archive";

type Tab = "board" | "register" | "appeal" | "archive" | "profile";

const TABS: { key: Tab; label: string }[] = [
  { key: "board", label: "成绩公示" },
  { key: "register", label: "登记/贴榜" },
  { key: "appeal", label: "申诉复核台" },
  { key: "archive", label: "版本留档" },
  { key: "profile", label: "单羽档案" },
];

const localNow = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
};

function patchText(appeal: Appeal, entry?: Entry): string {
  const p = appeal.patch;
  const parts: string[] = [];
  if (p.arrival !== undefined) {
    parts.push(
      `归巢时刻 ${entry ? fmtDateTime(entry.arrival) : "—"} → ${fmtDateTime(
        p.arrival
      )}`
    );
  }
  if (p.health) {
    parts.push(`健康 ${entry?.health ?? "—"} → ${p.health}`);
  }
  if (p.note !== undefined) parts.push(`备注：${p.note || "（清空）"}`);
  return parts.join("；");
}

export default function App() {
  const [races, setRaces] = useState<Race[]>(seedRaces);
  const [entries, setEntries] = useState<Entry[]>(seedEntries);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [versions, setVersions] = useState<BoardVersion[]>(() => [
    seedInitialVersion(seedRaces[0], seedEntries, "2026-09-14T18:00"),
    seedInitialVersion(seedRaces[1], seedEntries, "2026-09-20T18:00"),
  ]);

  const [tab, setTab] = useState<Tab>("board");
  const [boardRace, setBoardRace] = useState<string>("all");
  const [filter, setFilter] = useState<BoardFilter>(emptyFilter);
  const [profileRing, setProfileRing] = useState<string>(
    seedEntries[0].ring
  );
  const [archiveRaceId, setArchiveRaceId] = useState<string>(seedRaces[1].id);
  const [archiveVersionId, setArchiveVersionId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const notify = (text: string, kind: "ok" | "err" = "ok") => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  };

  // ---------- 派生：名次、提醒、待定都跟随当前（复核后）值 ----------
  const rows = useMemo(() => buildRows(races, entries), [races, entries]);
  const reminders = useMemo(
    () => buildReminders(races, entries),
    [races, entries]
  );
  const missing = useMemo(
    () => missingEntries(races, entries),
    [races, entries]
  );
  const pending = useMemo(() => pendingKeySet(appeals), [appeals]);
  const raceMap = useMemo(
    () => new Map(races.map((r) => [r.id, r])),
    [races]
  );
  const entryMap = useMemo(
    () =>
      new Map<string, Entry>(
        entries.map((e) => [`${e.raceId}|${e.ring}`, e])
      ),
    [entries]
  );

  const orderedRaces = useMemo(
    () =>
      [...races].sort((a, b) => (a.releaseAt < b.releaseAt ? 1 : -1)),
    [races]
  );
  const weatherOptions = useMemo(
    () => Array.from(new Set(races.map((r) => r.weather))),
    [races]
  );
  const rings = useMemo(
    () => Array.from(new Set(entries.map((e) => e.ring))).sort(),
    [entries]
  );

  const stats = useMemo(() => {
    const returned = entries.filter((e) => e.arrival).length;
    const rate = entries.length ? Math.round((returned / entries.length) * 100) : 0;
    const avgSpeed = rows.length
      ? Math.round(rows.reduce((s, r) => s + r.speed, 0) / rows.length)
      : 0;
    const certCount = rows.filter(
      (r) =>
        latestVersion(versions, r.raceId) &&
        !pending.has(pendingKey(r.raceId, r.entry.ring))
    ).length;
    return { rate, avgSpeed, missing: missing.length, pending: pending.size, certCount };
  }, [entries, rows, versions, pending, missing]);

  // ---------- 登记 / 贴榜 ----------
  const [raceForm, setRaceForm] = useState({
    name: "",
    location: "",
    distance: "100",
    weather: "晴",
    releaseAt: "",
  });
  const [entryForm, setEntryForm] = useState({
    raceId: "",
    ring: "",
    owner: "",
    lineage: "",
    arrival: "",
    health: "健康" as Health,
    note: "",
  });

  const submitRace = () => {
    const distance = Number(raceForm.distance);
    if (
      !raceForm.name.trim() ||
      !raceForm.location.trim() ||
      !Number.isFinite(distance) ||
      distance <= 0 ||
      !raceForm.releaseAt
    ) {
      notify("请完整填写场次、地点、有效距离和放飞时刻", "err");
      return;
    }
    const race: Race = {
      id: `race-${Date.now().toString(36)}`,
      name: raceForm.name.trim(),
      location: raceForm.location.trim(),
      distance,
      weather: raceForm.weather.trim() || "晴",
      releaseAt: raceForm.releaseAt,
    };
    setRaces((rs) => [...rs, race]);
    setEntryForm((f) => ({ ...f, raceId: race.id }));
    setRaceForm({ name: "", location: "", distance: "100", weather: "晴", releaseAt: "" });
    notify("训放场次已登记，可继续登记上笼鸽，完成后贴榜公示");
  };

  const submitEntry = () => {
    const race = raceMap.get(entryForm.raceId);
    if (!race) {
      notify("请先选择训放场次", "err");
      return;
    }
    if (latestVersion(versions, race.id)) {
      notify("该场次已贴榜公示，记录已锁定；更正请走申诉复核台", "err");
      return;
    }
    if (!entryForm.ring.trim() || !entryForm.owner.trim() || !entryForm.lineage.trim()) {
      notify("请填写足环号、鸽主与血统", "err");
      return;
    }
    const exists = entries.some(
      (e) => e.raceId === race.id && e.ring === entryForm.ring.trim()
    );
    if (exists) {
      notify("该足环号在此场次已登记，勿重复登记", "err");
      return;
    }
    const entry: Entry = {
      id: `e-${Date.now().toString(36)}`,
      raceId: race.id,
      ring: entryForm.ring.trim(),
      owner: entryForm.owner.trim(),
      lineage: entryForm.lineage.trim(),
      arrival: entryForm.arrival || null, // 未归巢不进速度榜
      health: entryForm.health,
      note: entryForm.note.trim() || undefined,
    };
    setEntries((es) => [...es, entry]);
    setEntryForm((f) => ({
      ...f,
      ring: "",
      owner: "",
      lineage: "",
      arrival: "",
      health: "健康",
      note: "",
    }));
    notify(`已登记 ${entry.ring}${entry.arrival ? "" : "（未归巢，不进速度榜）"}`);
  };

  const postBoard = (raceId: string) => {
    const race = raceMap.get(raceId);
    if (!race) return;
    const count = entries.filter((e) => e.raceId === raceId).length;
    if (count === 0) {
      notify("本场次还没有登记任何赛鸽，不能贴榜", "err");
      return;
    }
    const { archive, version } = archiveInitialBoard(
      versions,
      race,
      entries,
      appeals,
      localNow()
    );
    setVersions(archive);
    setBoardRace(raceId);
    setTab("board");
    notify(`《${race.name}》已贴榜公示（${version.title}），共 ${count} 羽上笼`);
  };

  // ---------- 申诉 ----------
  const [appealForm, setAppealForm] = useState<{
    raceId: string;
    ring: string;
    kind: AppealKind;
    summary: string;
    newArrival: string;
    newHealth: Health;
    newNote: string;
  }>({
    raceId: seedRaces[1].id,
    ring: "",
    kind: "报时更正",
    summary: "",
    newArrival: "",
    newHealth: "观察中",
    newNote: "",
  });

  const submitAppeal = () => {
    const race = raceMap.get(appealForm.raceId);
    if (!race || !appealForm.ring) {
      notify("请选择场次与足环号", "err");
      return;
    }
    if (!latestVersion(versions, race.id)) {
      notify("该场次尚未贴榜公示，暂不受理申诉（登记中可直接改记录）", "err");
      return;
    }
    if (openAppealExists(appeals, race.id, appealForm.ring)) {
      notify("同羽同场只允许一条未结申诉，请等当前申诉合议后再提", "err");
      return;
    }
    if (!appealForm.summary.trim()) {
      notify("请填写申诉事由（持报时或健康备注说明）", "err");
      return;
    }
    const patch =
      appealForm.kind === "报时更正"
        ? { arrival: appealForm.newArrival || null }
        : { health: appealForm.newHealth, note: appealForm.newNote.trim() };
    if (appealForm.kind === "报时更正" && !appealForm.newArrival) {
      notify("请填写更正后的归巢时刻", "err");
      return;
    }
    const appeal = makeAppeal({
      raceId: race.id,
      ring: appealForm.ring,
      kind: appealForm.kind,
      summary: appealForm.summary.trim(),
      patch,
      now: localNow(),
    });
    setAppeals((as) => [appeal, ...as]);
    setAppealForm((f) => ({ ...f, ring: "", summary: "", newArrival: "", newNote: "" }));
    notify("申诉已受理：榜单标“待定”，该羽证书停发，等待两人合议");
  };

  const castVote = (
    appealId: string,
    judgeIndex: 0 | 1,
    opinion: "" | "维持" | "改判",
    comment: string
  ) => {
    setAppeals((as) =>
      as.map((a) => (a.id === appealId ? withVote(a, judgeIndex, opinion, comment) : a))
    );
  };

  const resolveAppeal = (appealId: string) => {
    const appeal = appeals.find((a) => a.id === appealId);
    if (!appeal || !bothVoted(appeal)) return;
    const verdict =
      appeal.votes[0].opinion === "改判" && appeal.votes[1].opinion === "改判"
        ? "改判"
        : "维持";
    const now = localNow();

    if (verdict === "改判") {
      // 两席均改判：按新值更正，名次/提醒由派生层重算，旧版留档后落新版
      const nextEntries = entries.map((e) =>
        e.raceId === appeal.raceId && e.ring === appeal.ring
          ? patchEntry(e, appeal.patch)
          : e
      );
      const closedAppeal: Appeal = { ...appeal, status: "改判", closedAt: now };
      const nextAppeals = appeals.map((a) => (a.id === appealId ? closedAppeal : a));
      const race = raceMap.get(appeal.raceId);
      if (!race) return;
      const { archive } = archiveRevision(
        versions,
        race,
        nextEntries,
        nextAppeals,
        now,
        `${appeal.kind}（${appeal.ring}）：${appeal.summary}；两席一致改判`
      );
      setEntries(nextEntries);
      setAppeals(nextAppeals);
      setVersions(archive);
      notify("合议改判成立：成绩已按新值更新，名次重算，旧版已留档");
    } else {
      // 任一维持：维持原榜，不留新版
      setAppeals((as) =>
        as.map((a) =>
          a.id === appealId ? { ...a, status: "维持", closedAt: now } : a
        )
      );
      notify("合议结果：维持原榜（须两席均改判方可更正）");
    }
  };

  // ---------- 视图选择 ----------
  const viewRaces =
    boardRace === "all" ? orderedRaces : orderedRaces.filter((r) => r.id === boardRace);
  const viewReminders =
    boardRace === "all"
      ? reminders
      : reminders.filter((rm) => rm.race.id === boardRace);

  const archiveRace = raceMap.get(archiveRaceId) ?? orderedRaces[0];
  const archiveVersions = versions
    .filter((v) => v.raceId === archiveRace?.id)
    .sort((a, b) => b.version - a.version);
  const shownVersion =
    archiveVersions.find((v) => v.id === archiveVersionId) ?? archiveVersions[0];

  const profileRows = rows
    .filter((r) => r.entry.ring === profileRing)
    .sort((a, b) => (a.raceId < b.raceId ? -1 : 1));
  const profileAppeals = appeals.filter((a) => a.ring === profileRing);

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62014 · 源提示词9 · Port 62014</p>
        <h1>训放成绩公示与申诉复核台</h1>
        <span>
          登记地点、距离、天气、放飞与归巢时刻、健康状态；未归巢不进速度榜。
          鸽主持报时或健康备注可申诉，同羽同场只留一条未结申诉；两位复核员分别出具意见，
          两席均改判才更新成绩并旧版留档，否则维持原榜。申诉未结标“待定”并停发证书。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>归巢率（上笼 {entries.length} 羽）</small>
          <strong>{stats.rate}%</strong>
        </article>
        <article>
          <small>平均分速（米/分）</small>
          <strong>{stats.avgSpeed}</strong>
        </article>
        <article>
          <small>未归巢提醒</small>
          <strong className="warn">{stats.missing}</strong>
        </article>
        <article>
          <small>待定会审 / 可发证书</small>
          <strong>
            <span className="warn">{stats.pending}</span>
            <em> / {stats.certCount}</em>
          </strong>
        </article>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab active" : "tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className={`toast ${toast.kind}`}>{toast.text}</div>
      )}

      {/* ============ 成绩公示 ============ */}
      {tab === "board" && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>成绩公示</p>
              <h2>速度榜（未归巢不入榜）</h2>
            </div>
          </div>

          <FilterBar
            filter={filter}
            onChange={setFilter}
            weatherOptions={weatherOptions}
          />

          <div className="chips race-chips">
            <button
              className={boardRace === "all" ? "pick on" : "pick"}
              onClick={() => setBoardRace("all")}
            >
              全部场次
            </button>
            {orderedRaces.map((r) => {
              const v = latestVersion(versions, r.id);
              return (
                <button
                  key={r.id}
                  className={boardRace === r.id ? "pick on" : "pick"}
                  onClick={() => setBoardRace(r.id)}
                >
                  {r.name}
                  {v ? ` · v${v.version}` : " · 登记中"}
                </button>
              );
            })}
          </div>

          {viewRaces.length === 0 && <p className="empty">暂无场次。</p>}
          {viewRaces.map((race) => {
            const v = latestVersion(versions, race.id);
            const raceRows = rows
              .filter((r) => r.raceId === race.id)
              .filter((r) => rowMatches(r, race, filter, pending));
            return (
              <div key={race.id} className="board-block">
                <div className="board-head">
                  <h3>
                    {race.name}
                    {v ? (
                      <span className="tag tag-ok">公示中 · {v.title}</span>
                    ) : (
                      <span className="tag tag-draft">登记中 · 尚未贴榜</span>
                    )}
                  </h3>
                  <p className="race-meta">
                    {race.location} · {race.distance}km（{bandOf(race.distance)}）·
                    天气 {race.weather} · 放飞 {fmtDateTime(race.releaseAt)}
                  </p>
                </div>
                <div className="table-wrap">
                  <table className="board-table">
                    <thead>
                      <tr>
                        <th>名次</th>
                        <th>足环号</th>
                        <th>鸽主 / 血统</th>
                        <th>归巢时刻</th>
                        <th>飞行时长</th>
                        <th>分速(米/分)</th>
                        <th>健康</th>
                        <th>证书状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {raceRows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="empty">
                            无符合筛选的归巢记录（未归巢赛鸽见下方提醒，不进速度榜）
                          </td>
                        </tr>
                      )}
                      {raceRows.map((r) => {
                        const isPending = pending.has(
                          pendingKey(r.raceId, r.entry.ring)
                        );
                        return (
                          <tr
                            key={r.entry.id}
                            className={isPending ? "row-pending" : ""}
                          >
                            <td className="rank">
                              {isPending ? "待定" : r.rank}
                            </td>
                            <td>{r.entry.ring}</td>
                            <td>
                              {r.entry.owner}
                              <small>{r.entry.lineage}</small>
                            </td>
                            <td>{fmtDateTime(r.entry.arrival)}</td>
                            <td>{fmtMinutes(r.minutes)}</td>
                            <td className="speed">{Math.round(r.speed)}</td>
                            <td>
                              <HealthTag health={r.entry.health} />
                            </td>
                            <td>
                              {!v ? (
                                <span className="tag tag-draft">未公示</span>
                              ) : isPending ? (
                                <span className="tag tag-pending">
                                  待定 · 停发证书
                                </span>
                              ) : (
                                <span className="tag tag-ok">名次有效 · 可发证书</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <ReminderPanel reminders={viewReminders} races={viewRaces} />
        </section>
      )}

      {/* ============ 登记 / 贴榜 ============ */}
      {tab === "register" && (
        <section className="workspace">
          <div className="panel">
            <div className="heading">
              <div>
                <p>训放登记</p>
                <h2>新场次</h2>
              </div>
            </div>
            <div className="form-stack">
              <Field label="场次名称">
                <input
                  value={raceForm.name}
                  placeholder="如 2026秋训·第四站"
                  onChange={(e) => setRaceForm({ ...raceForm, name: e.target.value })}
                />
              </Field>
              <Field label="训放地点">
                <input
                  value={raceForm.location}
                  placeholder="如 郑州"
                  onChange={(e) =>
                    setRaceForm({ ...raceForm, location: e.target.value })
                  }
                />
              </Field>
              <div className="form-row">
                <Field label="放飞距离（公里）">
                  <input
                    type="number"
                    min={1}
                    value={raceForm.distance}
                    onChange={(e) =>
                      setRaceForm({ ...raceForm, distance: e.target.value })
                    }
                  />
                </Field>
                <Field label="天气">
                  <input
                    value={raceForm.weather}
                    placeholder="晴 / 多云 / 侧风"
                    onChange={(e) =>
                      setRaceForm({ ...raceForm, weather: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="放飞时刻">
                <input
                  type="datetime-local"
                  value={raceForm.releaseAt}
                  onChange={(e) =>
                    setRaceForm({ ...raceForm, releaseAt: e.target.value })
                  }
                />
              </Field>
              <button className="primary" onClick={submitRace}>
                登记场次
              </button>
            </div>

            <div className="race-list">
              <h3>本场次一览</h3>
              {orderedRaces.map((r) => {
                const v = latestVersion(versions, r.id);
                const count = entries.filter((e) => e.raceId === r.id).length;
                return (
                  <div key={r.id} className="race-item">
                    <div>
                      <b>{r.name}</b>
                      <p>
                        {r.location} · {r.distance}km · {r.weather} · 上笼 {count}{" "}
                        羽
                      </p>
                    </div>
                    {v ? (
                      <span className="tag tag-ok">已公示 v{v.version}</span>
                    ) : (
                      <button className="mini" onClick={() => postBoard(r.id)}>
                        贴榜公示（存初榜 v1）
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="heading">
              <div>
                <p>上笼 / 归巢登记</p>
                <h2>登记赛鸽</h2>
              </div>
            </div>
            <div className="form-stack">
              <Field label="所属场次（仅“登记中”场次可新增）">
                <select
                  value={entryForm.raceId}
                  onChange={(e) =>
                    setEntryForm({ ...entryForm, raceId: e.target.value })
                  }
                >
                  <option value="">请选择场次</option>
                  {orderedRaces.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {latestVersion(versions, r.id) ? "（已公示，锁定）" : "（登记中）"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-row">
                <Field label="足环号">
                  <input
                    value={entryForm.ring}
                    placeholder="CHN-24-001839"
                    onChange={(e) =>
                      setEntryForm({ ...entryForm, ring: e.target.value })
                    }
                  />
                </Field>
                <Field label="鸽主">
                  <input
                    value={entryForm.owner}
                    placeholder="鸽主姓名"
                    onChange={(e) =>
                      setEntryForm({ ...entryForm, owner: e.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="血统">
                  <input
                    value={entryForm.lineage}
                    placeholder="詹森系 / 凡龙系…"
                    onChange={(e) =>
                      setEntryForm({ ...entryForm, lineage: e.target.value })
                    }
                  />
                </Field>
                <Field label="健康状态">
                  <select
                    value={entryForm.health}
                    onChange={(e) =>
                      setEntryForm({ ...entryForm, health: e.target.value as Health })
                    }
                  >
                    {HEALTH_OPTIONS.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="归巢时刻（留空 = 未归巢，不进速度榜）">
                <input
                  type="datetime-local"
                  value={entryForm.arrival}
                  onChange={(e) =>
                    setEntryForm({ ...entryForm, arrival: e.target.value })
                  }
                />
              </Field>
              <Field label="健康备注">
                <input
                  value={entryForm.note}
                  placeholder="如 右翼擦伤、归巢稍疲"
                  onChange={(e) =>
                    setEntryForm({ ...entryForm, note: e.target.value })
                  }
                />
              </Field>
              <button className="primary" onClick={submitEntry}>
                保存登记
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ============ 申诉复核台 ============ */}
      {tab === "appeal" && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>申诉复核台</p>
              <h2>鸽主持报时 / 健康备注发起申诉</h2>
            </div>
          </div>

          <div className="appeal-form">
            <div className="form-row">
              <Field label="场次">
                <select
                  value={appealForm.raceId}
                  onChange={(e) =>
                    setAppealForm({ ...appealForm, raceId: e.target.value, ring: "" })
                  }
                >
                  {orderedRaces.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {latestVersion(versions, r.id) ? "" : "（未公示，不可申诉）"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="足环号">
                <select
                  value={appealForm.ring}
                  onChange={(e) =>
                    setAppealForm({ ...appealForm, ring: e.target.value })
                  }
                >
                  <option value="">请选择赛鸽</option>
                  {entries
                    .filter((e) => e.raceId === appealForm.raceId)
                    .map((e) => (
                      <option key={e.id} value={e.ring}>
                        {e.ring} · {e.owner}（当前归巢：
                        {fmtDateTime(e.arrival)} / {e.health}）
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="form-row">
              <Field label="申诉类型">
                <select
                  value={appealForm.kind}
                  onChange={(e) =>
                    setAppealForm({
                      ...appealForm,
                      kind: e.target.value as AppealKind,
                    })
                  }
                >
                  <option>报时更正</option>
                  <option>健康备注</option>
                </select>
              </Field>
              {appealForm.kind === "报时更正" ? (
                <Field label="更正后的归巢时刻">
                  <input
                    type="datetime-local"
                    value={appealForm.newArrival}
                    onChange={(e) =>
                      setAppealForm({ ...appealForm, newArrival: e.target.value })
                    }
                  />
                </Field>
              ) : (
                <>
                  <Field label="更正后的健康状态">
                    <select
                      value={appealForm.newHealth}
                      onChange={(e) =>
                        setAppealForm({
                          ...appealForm,
                          newHealth: e.target.value as Health,
                        })
                      }
                    >
                      {HEALTH_OPTIONS.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="健康备注">
                    <input
                      value={appealForm.newNote}
                      placeholder="如 复核为带伤，需静养"
                      onChange={(e) =>
                        setAppealForm({ ...appealForm, newNote: e.target.value })
                      }
                    />
                  </Field>
                </>
              )}
            </div>
            <Field label="申诉事由">
              <input
                value={appealForm.summary}
                placeholder="鸽主持报到钟显 / 健康检查单说明情况"
                onChange={(e) =>
                  setAppealForm({ ...appealForm, summary: e.target.value })
                }
              />
            </Field>
            <button className="primary" onClick={submitAppeal}>
              提交申诉（榜单即标待定、停发证书）
            </button>
          </div>

          <h3 className="appeal-group-title">
            未结申诉（{appeals.filter((a) => a.status === "未结").length}）
          </h3>
          <div className="appeal-list">
            {appeals
              .filter((a) => a.status === "未结")
              .map((a) => (
                <AppealCard
                  key={a.id}
                  appeal={a}
                  race={raceMap.get(a.raceId)}
                  entry={entryMap.get(pendingKey(a.raceId, a.ring))}
                  onVote={castVote}
                  onResolve={resolveAppeal}
                />
              ))}
            {appeals.every((a) => a.status !== "未结") && (
              <p className="empty">当前没有未结申诉。</p>
            )}
          </div>

          <h3 className="appeal-group-title">已结合议</h3>
          <div className="appeal-list closed">
            {appeals
              .filter((a) => a.status !== "未结")
              .map((a) => (
                <ClosedAppeal
                  key={a.id}
                  appeal={a}
                  race={raceMap.get(a.raceId)}
                  entry={entryMap.get(pendingKey(a.raceId, a.ring))}
                />
              ))}
            {appeals.every((a) => a.status === "未结") && (
              <p className="empty">暂无已结申诉。</p>
            )}
          </div>
        </section>
      )}

      {/* ============ 版本留档 ============ */}
      {tab === "archive" && (
        <section className="workspace archive-layout">
          <aside className="panel">
            <p className="eyebrow">旧版留档</p>
            <h2>公示版本</h2>
            <Field label="选择场次">
              <select
                value={archiveRaceId}
                onChange={(e) => {
                  setArchiveRaceId(e.target.value);
                  setArchiveVersionId(null);
                }}
              >
                {orderedRaces.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="version-list">
              {archiveVersions.map((v) => (
                <button
                  key={v.id}
                  className={
                    shownVersion?.id === v.id ? "version on" : "version"
                  }
                  onClick={() => setArchiveVersionId(v.id)}
                >
                  <b>{v.title}</b>
                  <span>{fmtDateTime(v.archivedAt)}</span>
                  <small>{v.note}</small>
                </button>
              ))}
              {archiveVersions.length === 0 && (
                <p className="empty">该场次尚未贴榜，无留档。</p>
              )}
            </div>
          </aside>

          <div className="panel">
            {shownVersion && archiveRace && (
              <>
                <div className="heading">
                  <div>
                    <p>档案跟随复核 · 同一套筛选</p>
                    <h2>
                      {archiveRace.name} · {shownVersion.title}
                    </h2>
                  </div>
                  {shownVersion.version === (archiveVersions[0]?.version ?? 1) ? (
                    <span className="tag tag-ok">当前公示版</span>
                  ) : (
                    <span className="tag tag-pending">旧版留档 · 已被改判版替代</span>
                  )}
                </div>
                <p className="race-meta">{shownVersion.note}</p>
                <FilterBar
                  filter={filter}
                  onChange={setFilter}
                  weatherOptions={weatherOptions}
                />
                <ArchivedBoard
                  version={shownVersion}
                  race={archiveRace}
                  filter={filter}
                />
              </>
            )}
          </div>
        </section>
      )}

      {/* ============ 单羽档案 ============ */}
      {tab === "profile" && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>单羽赛鸽档案</p>
              <h2>历史成绩（取复核后现值）</h2>
            </div>
          </div>
          <div className="chips ring-chips">
            {rings.map((ring) => (
              <button
                key={ring}
                className={profileRing === ring ? "pick on" : "pick"}
                onClick={() => setProfileRing(ring)}
              >
                {ring}
              </button>
            ))}
          </div>
          <FilterBar
            filter={filter}
            onChange={setFilter}
            weatherOptions={weatherOptions}
          />

          {profileRows
            .filter((r) => {
              const race = raceMap.get(r.raceId);
              return race && rowMatches(r, race, filter, pending);
            })
            .map((r) => {
              const race = raceMap.get(r.raceId)!;
              const v = latestVersion(versions, race.id);
              const isPending = pending.has(
                pendingKey(r.raceId, r.entry.ring)
              );
              return (
                <div key={r.entry.id} className="profile-row">
                  <b>{race.name}</b>
                  <span>
                    {race.location} · {race.distance}km · {race.weather}
                  </span>
                  <span>
                    名次 {isPending ? "待定" : r.rank} · {Math.round(r.speed)}{" "}
                    米/分 · {fmtMinutes(r.minutes)}
                  </span>
                  <span>
                    <HealthTag health={r.entry.health} />
                    {r.entry.note ? `（${r.entry.note}）` : ""}
                  </span>
                  <span>
                    {!v ? (
                      <span className="tag tag-draft">未公示</span>
                    ) : isPending ? (
                      <span className="tag tag-pending">待定 · 停发证书</span>
                    ) : (
                      <span className="tag tag-ok">可发证书</span>
                    )}
                  </span>
                </div>
              );
            })}
          {profileRows.filter((r) => {
            const race = raceMap.get(r.raceId);
            return race && rowMatches(r, race, filter, pending);
          }).length === 0 && (
            <p className="empty">该羽暂无符合筛选的归巢成绩（未归巢场次只在提醒中出现）。</p>
          )}

          <h3 className="appeal-group-title">该羽申诉轨迹</h3>
          <div className="appeal-list closed">
            {profileAppeals.map((a) => (
              <ClosedAppeal
                key={a.id}
                appeal={a}
                race={raceMap.get(a.raceId)}
                entry={entryMap.get(pendingKey(a.raceId, a.ring))}
              />
            ))}
            {profileAppeals.length === 0 && (
              <p className="empty">该羽暂无申诉记录。</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

/* ---------------- 子组件 ---------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FilterBar({
  filter,
  onChange,
  weatherOptions,
}: {
  filter: BoardFilter;
  onChange: (f: BoardFilter) => void;
  weatherOptions: string[];
}) {
  return (
    <div className="filter-bar">
      <div className="chips">
        {BANDS.map((b: Band) => (
          <button
            key={b}
            className={filter.band === b ? "pick on" : "pick"}
            onClick={() => onChange({ ...filter, band: b })}
          >
            {b}
          </button>
        ))}
      </div>
      <select
        value={filter.weather}
        onChange={(e) => onChange({ ...filter, weather: e.target.value })}
      >
        <option value="">全部天气</option>
        {weatherOptions.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </select>
      <select
        value={filter.health}
        onChange={(e) =>
          onChange({ ...filter, health: e.target.value as "" | Health })
        }
      >
        <option value="">全部健康状态</option>
        {HEALTH_OPTIONS.map((h) => (
          <option key={h}>{h}</option>
        ))}
      </select>
      <input
        className="filter-query"
        placeholder="足环号 / 鸽主 / 血统"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <button
        className={filter.pendingOnly ? "pick on" : "pick"}
        onClick={() => onChange({ ...filter, pendingOnly: !filter.pendingOnly })}
      >
        只看待定
      </button>
      <button className="pick" onClick={() => onChange(emptyFilter)}>
        清空筛选
      </button>
    </div>
  );
}

function HealthTag({ health }: { health: Health }) {
  const cls =
    health === "健康"
      ? "tag tag-ok"
      : health === "带伤"
      ? "tag tag-bad"
      : "tag tag-warn";
  return <span className={cls}>{health}</span>;
}

function ReminderPanel({
  reminders,
  races,
}: {
  reminders: ReturnType<typeof buildReminders>;
  races: Race[];
}) {
  const missing = reminders.filter((r) => r.kind === "未归巢");
  const health = reminders.filter((r) => r.kind === "健康异常");
  if (races.length === 0) return null;
  return (
    <div className="reminders">
      <div className="reminder-col">
        <h3>
          未归巢提醒（{missing.length}）<small>不进速度榜</small>
        </h3>
        {missing.map((r) => (
          <div key={r.entry.id} className="reminder bad">
            <b>{r.entry.ring}</b>
            <span>
              {r.entry.owner} · {r.entry.lineage}
            </span>
            <p>{r.text}</p>
          </div>
        ))}
        {missing.length === 0 && <p className="empty">本视图全部归巢。</p>}
      </div>
      <div className="reminder-col">
        <h3>
          健康复查提醒（{health.length}）
          <small>随健康备注实时重算</small>
        </h3>
        {health.map((r) => (
          <div key={r.entry.id} className="reminder warn">
            <b>{r.entry.ring}</b>
            <span>
              {r.entry.owner} · {r.entry.lineage}
            </span>
            <p>{r.text}</p>
          </div>
        ))}
        {health.length === 0 && <p className="empty">无健康异常。</p>}
      </div>
    </div>
  );
}

function AppealCard({
  appeal,
  race,
  entry,
  onVote,
  onResolve,
}: {
  appeal: Appeal;
  race?: Race;
  entry?: Entry;
  onVote: (id: string, i: 0 | 1, opinion: "" | "维持" | "改判", comment: string) => void;
  onResolve: (id: string) => void;
}) {
  return (
    <article className="appeal-card">
      <header>
        <div>
          <b>{appeal.ring}</b>
          <span className="tag tag-pending">未结 · 待定 · 停发证书</span>
        </div>
        <p>
          {race?.name} · {appeal.kind} · 提请于 {fmtDateTime(appeal.createdAt)}
        </p>
        <p className="appeal-summary">{appeal.summary}</p>
        <p className="patch-line">申请内容：{patchText(appeal, entry)}</p>
      </header>
      <div className="judge-grid">
        {appeal.votes.map((vote, i) => (
          <div key={vote.name} className="judge-box">
            <h4>{JUDGE_NAMES[i]}</h4>
            <div className="chips">
              {(["维持", "改判"] as const).map((op) => (
                <button
                  key={op}
                  className={vote.opinion === op ? "pick on" : "pick"}
                  onClick={() =>
                    onVote(appeal.id, i as 0 | 1, op, vote.comment)
                  }
                >
                  {op}原榜
                </button>
              ))}
            </div>
            <input
              placeholder="意见依据（报到记录 / 体检单…）"
              value={vote.comment}
              onChange={(e) =>
                onVote(appeal.id, i as 0 | 1, vote.opinion, e.target.value)
              }
            />
          </div>
        ))}
      </div>
      <footer>
        {bothVoted(appeal) ? (
          <>
            <span className="rule-hint">
              两席已到齐：
              {appeal.votes.every((v) => v.opinion === "改判")
                ? "均判改判 → 将更新成绩并重算名次，旧版留档"
                : "未达成两席改判 → 合议后维持原榜"}
            </span>
            <button className="primary" onClick={() => onResolve(appeal.id)}>
              合议定案
            </button>
          </>
        ) : (
          <span className="rule-hint">
            两人须分别出具意见；两席均为“改判”方可更正成绩，任一“维持”即维持原榜。
          </span>
        )}
      </footer>
    </article>
  );
}

function ClosedAppeal({
  appeal,
  race,
  entry,
}: {
  appeal: Appeal;
  race?: Race;
  entry?: Entry;
}) {
  const changed = appeal.status === "改判";
  return (
    <div className="closed-appeal">
      <div>
        <b>{appeal.ring}</b>
        <span className={changed ? "tag tag-ok" : "tag tag-draft"}>
          {changed ? "合议改判 · 已更新成绩" : "合议维持 · 原榜不变"}
        </span>
        <p>
          {race?.name} · {appeal.kind} · {fmtDateTime(appeal.createdAt)}
          {appeal.closedAt ? ` → 定案 ${fmtDateTime(appeal.closedAt)}` : ""}
        </p>
        <p className="appeal-summary">{appeal.summary}</p>
        <p className="patch-line">申请内容：{patchText(appeal, entry)}</p>
        <p className="votes-line">
          合议意见：
          {appeal.votes.map((v) => `${v.name.split(" · ")[0]} ${v.opinion || "缺席"}`).join("，")}
        </p>
      </div>
    </div>
  );
}

function ArchivedBoard({
  version,
  race,
  filter,
}: {
  version: BoardVersion;
  race: Race;
  filter: BoardFilter;
}) {
  const pending = new Set(version.pendingKeys);
  const rows = version.rows.filter((r) => rowMatches(r, race, filter, pending));
  return (
    <div className="table-wrap">
      <table className="board-table">
        <thead>
          <tr>
            <th>名次</th>
            <th>足环号</th>
            <th>鸽主 / 血统</th>
            <th>归巢时刻</th>
            <th>飞行时长</th>
            <th>分速(米/分)</th>
            <th>健康</th>
            <th>当时状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isPending = pending.has(pendingKey(r.raceId, r.entry.ring));
            return (
              <tr key={r.entry.id} className={isPending ? "row-pending" : ""}>
                <td className="rank">{isPending ? "待定" : r.rank}</td>
                <td>{r.entry.ring}</td>
                <td>
                  {r.entry.owner}
                  <small>{r.entry.lineage}</small>
                </td>
                <td>{fmtDateTime(r.entry.arrival)}</td>
                <td>{fmtMinutes(r.minutes)}</td>
                <td className="speed">{Math.round(r.speed)}</td>
                <td>
                  <HealthTag health={r.entry.health} />
                </td>
                <td>
                  {isPending ? (
                    <span className="tag tag-pending">待定 · 停发证书</span>
                  ) : (
                    <span className="tag tag-ok">有效</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                该版本下无符合筛选的记录。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

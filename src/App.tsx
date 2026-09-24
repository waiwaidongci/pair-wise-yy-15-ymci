import { useSyncExternalStore, useMemo, useState } from "react";
import "./styles.css";
import {
  Appeal,
  BoardRow,
  Entry,
  EntryPatch,
  HEALTH_VALUES,
  Health,
  Opinion,
  RaceEvent,
  REVIEWER_NAME,
  ReviewerId,
  compareBoards,
  describePatch,
  formatClock,
  formatDuration,
  formatSpeed,
} from "./judging";
import { store } from "./storage";

type Tab = "board" | "review" | "archive";
type AppealFilter = "全部" | "未结" | "改判" | "维持";
type HealthFilter = "全部" | Health;

interface Filters {
  query: string;
  health: HealthFilter;
  appeal: AppealFilter;
  /** 跟随复核：从复核台点“在榜面/档案定位”后设置，榜面与档案都只看这一羽 */
  focusEntryId: string | null;
}

function useStore() {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", { hour12: false });
}

function km(distance: number): string {
  return `${(distance / 1000).toFixed(distance % 1000 === 0 ? 0 : 1)} 公里`;
}

function App() {
  const state = useStore();
  const [tab, setTab] = useState<Tab>("board");
  const [eventId, setEventId] = useState<string>(state.events[0]?.id ?? "");
  const [filters, setFilters] = useState<Filters>({
    query: "",
    health: "全部",
    appeal: "全部",
    focusEntryId: null,
  });

  const event = state.events.find((e) => e.id === eventId) ?? state.events[0];

  const followEntry = (entryId: string, goTab: Tab) => {
    setFilters((f) => ({ ...f, focusEntryId: entryId }));
    setTab(goTab);
  };

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>训放成绩公示与申诉复核台</h1>
          <p>登记地点 · 距离 · 天气 · 归巢时刻 · 健康状态 ｜ 更正重算、旧版留档 ｜ 两人复核均改判才更新成绩</p>
        </div>
        <div className="topbar-right">
          <select value={event?.id ?? ""} onChange={(e) => setEventId(e.target.value)}>
            {state.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <NewEventButton onCreated={(id) => setEventId(id)} />
          <button className="ghost" onClick={() => { store.resetDemo(); setFilters({ query: "", health: "全部", appeal: "全部", focusEntryId: null }); }}>
            重置演示数据
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}>成绩公示榜</button>
        <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>
          申诉复核台
        </button>
        <button className={tab === "archive" ? "active" : ""} onClick={() => setTab("archive")}>历史档案（旧版留档）</button>
      </nav>

      {event && tab === "board" && (
        <BoardTab
          event={event}
          filters={filters}
          setFilters={setFilters}
          followEntry={followEntry}
        />
      )}
      {event && tab === "review" && (
        <ReviewTab event={event} filters={filters} setFilters={setFilters} followEntry={followEntry} />
      )}
      {event && tab === "archive" && <ArchiveTab event={event} filters={filters} setFilters={setFilters} />}
    </main>
  );
}

// ---------- 通用筛选条（榜面与档案共用） ----------

function FilterBar({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
}) {
  return (
    <div className="filterbar">
      <input
        placeholder="搜索足环号 / 鸽主 / 血统"
        value={filters.query}
        onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
      />
      <select
        value={filters.health}
        onChange={(e) => setFilters((f) => ({ ...f, health: e.target.value as HealthFilter }))}
      >
        <option value="全部">健康：全部</option>
        {HEALTH_VALUES.map((h) => (
          <option key={h} value={h}>健康：{h}</option>
        ))}
      </select>
      <select
        value={filters.appeal}
        onChange={(e) => setFilters((f) => ({ ...f, appeal: e.target.value as AppealFilter }))}
      >
        <option value="全部">申诉：全部</option>
        <option value="未结">仅未结（待定）</option>
        <option value="改判">已改判</option>
        <option value="维持">已维持</option>
      </select>
      {filters.focusEntryId && (
        <button className="chip-on" onClick={() => setFilters((f) => ({ ...f, focusEntryId: null }))}>
          跟随复核中 ✕
        </button>
      )}
    </div>
  );
}

function useFilteredRows(rows: BoardRow[], filters: Filters): BoardRow[] {
  const state = useStore();
  return useMemo(() => {
    const q = filters.query.trim();
    return rows.filter((r) => {
      if (filters.focusEntryId && r.entryId !== filters.focusEntryId) return false;
      if (filters.health !== "全部" && r.health !== filters.health) return false;
      // 行已在单场范围内，按 entryId 匹配该羽本场申诉即可
      if (filters.appeal === "未结" && !r.pending) return false;
      if (filters.appeal === "改判" || filters.appeal === "维持") {
        const hit = state.appeals.some(
          (a) => a.entryId === r.entryId && a.status === filters.appeal,
        );
        if (!hit) return false;
      }
      if (q && !`${r.ring} ${r.owner} ${r.bloodline}`.includes(q)) return false;
      return true;
    });
  }, [rows, filters, state]);
}

// ---------- 成绩公示榜 ----------

function BoardTab({
  event,
  filters,
  setFilters,
  followEntry,
}: {
  event: RaceEvent;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  followEntry: (id: string, tab: Tab) => void;
}) {
  const { board } = store.currentBoard(event.id);
  const rows = useFilteredRows(board, filters);
  const [entryModal, setEntryModal] = useState<null | { mode: "add" | "edit"; entry?: Entry }>(null);
  const [appealFor, setAppealFor] = useState<Entry | null>(null);

  const entriesAll = store.getState().entries.filter((e) => e.eventId === event.id);
  const returned = entriesAll.filter((e) => e.homeTime !== null).length;
  const speeds = board.map((r) => r.speed).filter((s): s is number => s !== null);
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  const pendingCount = board.filter((r) => r.pending).length;
  const lostCount = entriesAll.length - returned;
  const focusEntry = filters.focusEntryId
    ? entriesAll.find((e) => e.id === filters.focusEntryId)
    : null;

  return (
    <>
      <section className="event-card">
        <div className="event-head">
          <div>
            <h2>{event.name}</h2>
            <p>
              <b>司放地点</b>{event.location}　·　<b>距离</b>{km(event.distance)}　·
              <b>天气</b>{event.weather}　·　<b>司放时刻</b>{formatClock(event.releaseTime)}
            </p>
          </div>
          <EventEditButton event={event} />
        </div>
        <div className="stats">
          <Stat label="归巢率" value={`${returned}/${entriesAll.length}`} />
          <Stat label="平均分速（米/分）" value={formatSpeed(avgSpeed)} />
          <Stat label="待定（申诉未结）" value={String(pendingCount)} tone={pendingCount ? "warn" : undefined} />
          <Stat label="未归巢" value={String(lostCount)} tone={lostCount ? "bad" : undefined} />
        </div>
      </section>

      {focusEntry && (
        <div className="follow-banner">
          正在跟随复核：{focusEntry.ring}（{focusEntry.owner}）——榜面只显示这一羽
          <button onClick={() => setFilters((f) => ({ ...f, focusEntryId: null }))}>取消跟随</button>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <FilterBar filters={filters} setFilters={setFilters} />
          <button className="primary" onClick={() => setEntryModal({ mode: "add" })}>登记归巢 / 未归巢</button>
        </div>

        <div className="table-wrap">
          <table className="board-table">
            <thead>
              <tr>
                <th>名次</th><th>足环号</th><th>鸽主</th><th>血统</th>
                <th>归巢时刻</th><th>飞行时长</th><th>分速（米/分）</th>
                <th>健康状态</th><th>证书</th><th>提醒</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <BoardRowView
                  key={r.entryId}
                  row={r}
                  onAppeal={() => setAppealFor(store.getEntry(r.entryId))}
                  onEdit={() => setEntryModal({ mode: "edit", entry: store.getEntry(r.entryId) })}
                  onFollow={() => followEntry(r.entryId, "review")}
                />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={11} className="empty">没有符合筛选条件的记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="foot-note">
          规则：未归巢（含报时时刻异常）不进速度榜；申诉未结标“待定”并停发证书；
          更正登记或赛事信息后名次、分速、提醒按新值重算，上一版自动留档。
        </p>
      </section>

      {entryModal && (
        <EntryModal
          event={event}
          mode={entryModal.mode}
          entry={entryModal.entry}
          onClose={() => setEntryModal(null)}
        />
      )}
      {appealFor && <AppealModal event={event} entry={appealFor} onClose={() => setAppealFor(null)} />}
    </>
  );
}

function CertBadge({ cert }: { cert: BoardRow["cert"] }) {
  const cls =
    cert === "可发" ? "cert-ok"
    : cert === "待定停发" ? "cert-pending"
    : cert === "健康暂缓" ? "cert-health"
    : "cert-none";
  const text =
    cert === "可发" ? "可发证书"
    : cert === "待定停发" ? "待定 · 停发"
    : cert === "健康暂缓" ? "暂缓 · 健康"
    : "不入榜";
  return <span className={`badge ${cls}`}>{text}</span>;
}

function BoardRowView({
  row,
  onAppeal,
  onEdit,
  onFollow,
}: {
  row: BoardRow;
  onAppeal: () => void;
  onEdit: () => void;
  onFollow: () => void;
}) {
  return (
    <tr className={row.pending ? "row-pending" : row.rank === null ? "row-out" : ""}>
      <td className="rank-cell">
        {row.rank === null ? (
          <span className="rank-none">—</span>
        ) : row.pending ? (
          <>
            <span className="badge cert-pending">待定</span>
            <span className="rank-old">原第 {row.rank} 名</span>
          </>
        ) : (
          <span className={`rank rank-${row.rank <= 3 ? row.rank : "n"}`}>{row.rank}</span>
        )}
      </td>
      <td className="ring">{row.ring}</td>
      <td>{row.owner}</td>
      <td>{row.bloodline}</td>
      <td>{formatClock(row.homeTime)}</td>
      <td>{formatDuration(row.durationMin)}</td>
      <td className="speed">{formatSpeed(row.speed)}</td>
      <td><span className={`health h-${row.health}`}>{row.health}</span></td>
      <td><CertBadge cert={row.cert} /></td>
      <td className="reminders">
        {row.reminders.map((m) => <span key={m} className="reminder">{m}</span>)}
      </td>
      <td className="actions">
        <button onClick={onEdit}>更正登记</button>
        <button onClick={onAppeal}>发起申诉</button>
        {row.pending && <button className="linkish" onClick={onFollow}>去复核台 →</button>}
      </td>
    </tr>
  );
}

// ---------- 申诉复核台 ----------

function ReviewTab({
  event,
  filters,
  setFilters,
  followEntry,
}: {
  event: RaceEvent;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  followEntry: (id: string, tab: Tab) => void;
}) {
  const appeals = store.appealsOf(event.id);
  const q = filters.query.trim();
  const shown = appeals.filter((a) => {
    if (filters.focusEntryId && a.entryId !== filters.focusEntryId) return false;
    if (filters.appeal !== "全部" && a.status !== filters.appeal) return false;
    if (filters.health !== "全部") {
      const entry = store.getEntry(a.entryId);
      if (entry.health !== filters.health) return false;
    }
    if (q && !`${a.ring} ${entryName(a.entryId)}`.includes(q)) return false;
    return true;
  });

  function entryName(entryId: string) {
    return store.getEntry(entryId).owner;
  }

  const open = shown.filter((a) => a.status === "未结");
  const closed = shown.filter((a) => a.status !== "未结");

  return (
    <>
      <section className="rule-box">
        <h3>复核规则</h3>
        <ul>
          <li>同羽同场只保留一条未结申诉；未结期间榜面标“待定”，证书停发。</li>
          <li>两名复核员分别独立给出“维持 / 改判”意见，先提交者的意见即刻封存、对后提交者不可见。</li>
          <li>两人意见均为“改判”才更新成绩（按鸽主申请内容更正登记 → 名次与提醒按新值重算 → 旧版留档）；任一“维持”即维持原榜。</li>
        </ul>
      </section>

      <div className="panel-head">
        <FilterBar filters={filters} setFilters={setFilters} />
      </div>

      <h3 className="section-title">未结申诉（{open.length}）</h3>
      {open.map((a) => (
        <AppealCard key={a.id} event={event} appeal={a} onFollowBoard={(id) => followEntry(id, "board")} onFollowArchive={(id) => followEntry(id, "archive")} />
      ))}
      {open.length === 0 && <p className="empty-panel">当前没有未结申诉。</p>}

      <h3 className="section-title">已结申诉（{closed.length}）</h3>
      {closed.map((a) => (
        <AppealCard key={a.id} event={event} appeal={a} onFollowBoard={(id) => followEntry(id, "board")} onFollowArchive={(id) => followEntry(id, "archive")} />
      ))}
      {closed.length === 0 && <p className="empty-panel">暂无已结申诉。</p>}
    </>
  );
}

function AppealCard({
  event,
  appeal,
  onFollowBoard,
  onFollowArchive,
}: {
  event: RaceEvent;
  appeal: Appeal;
  onFollowBoard: (id: string) => void;
  onFollowArchive: (id: string) => void;
}) {
  const entry = store.getEntry(appeal.entryId);
  const [reviewer, setReviewer] = useState<ReviewerId>("A");
  const [opinion, setOpinion] = useState<Opinion>("改判");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    try {
      store.vote(event.id, appeal.id, reviewer, opinion, comment.trim() || "（无附言）");
      setComment("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const statusCls = appeal.status === "未结" ? "cert-pending" : appeal.status === "改判" ? "cert-ok" : "cert-none";
  const diffs = describePatch(entry, appeal.proposal);

  return (
    <section className={`appeal-card ${appeal.status === "未结" ? "open" : "closed"}`}>
      <header>
        <div>
          <span className={`badge ${statusCls}`}>{appeal.status === "未结" ? "未结 · 待定停证" : appeal.status === "改判" ? "已改判" : "维持原榜"}</span>
          <h3>{appeal.ring} · {entry.owner} · {entry.bloodline}</h3>
        </div>
        <div className="appeal-meta">
          <span>{appeal.reason}</span>
          <span>{fmtTime(appeal.createdAt)}</span>
          <button onClick={() => onFollowBoard(appeal.entryId)}>榜面定位</button>
          <button onClick={() => onFollowArchive(appeal.entryId)}>档案跟随</button>
        </div>
      </header>

      <p className="appeal-detail"><b>鸽主陈述：</b>{appeal.detail}</p>
      <div className="proposal">
        <b>申请更正：</b>
        {diffs.map((d) => <span key={d} className="proposal-item">{d}</span>)}
      </div>

      <div className="votes">
        {(["A", "B"] as ReviewerId[]).map((r) => {
          const v = appeal.votes.find((x) => x.reviewer === r);
          return (
            <div key={r} className={`vote ${v ? "done" : "wait"}`}>
              <b>{REVIEWER_NAME[r]}</b>
              {v && appeal.status !== "未结" ? (
                <span>{v.opinion} · {v.comment} <i>{fmtTime(v.at)}</i></span>
              ) : v ? (
                <span className="sealed">已提交并封存，等待另一人</span>
              ) : (
                <span className="sealed">尚未提交</span>
              )}
            </div>
          );
        })}
      </div>

      {appeal.status === "未结" && (
        <div className="vote-form">
          <div className="vote-row">
            <label>我是
              <select value={reviewer} onChange={(e) => setReviewer(e.target.value as ReviewerId)}>
                <option value="A">{REVIEWER_NAME.A}</option>
                <option value="B">{REVIEWER_NAME.B}</option>
              </select>
            </label>
            <label>意见
              <select value={opinion} onChange={(e) => setOpinion(e.target.value as Opinion)}>
                <option value="改判">改判</option>
                <option value="维持">维持</option>
              </select>
            </label>
            <input
              placeholder="复核附言（凭证、依据……）"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button className="primary" onClick={submit}>提交意见（提交后不可更改）</button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}

      <details className="trail">
        <summary>操作轨迹（{appeal.trail.length}）</summary>
        <ol>
          {appeal.trail.map((t, i) => (
            <li key={i}><time>{fmtTime(t.at)}</time>{t.text}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

// ---------- 历史档案 ----------

function ArchiveTab({
  event,
  filters,
  setFilters,
}: {
  event: RaceEvent;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
}) {
  const versions = store.versionsOf(event.id).slice().reverse();
  const focusEntry = filters.focusEntryId;
  const q = filters.query.trim();

  return (
    <>
      <div className="panel-head">
        <FilterBar filters={filters} setFilters={setFilters} />
      </div>
      <p className="foot-note">
        每次更正（登记更正、赛事信息更正、两人改判成立）都会在生效前把当前榜面完整留档；
        档案跟随当前筛选，点击“档案跟随”后只看被复核的那一羽在各版中的名次与分速变化。
      </p>

      {versions.map((v, idx) => {
        const older = versions[idx + 1]; // 列表倒序，下一张是更早版本
        const diff = older ? compareBoards(older.board, v.board) : null;
        let rows = v.board;
        if (focusEntry) rows = rows.filter((r) => r.entryId === focusEntry);
        if (filters.health !== "全部") rows = rows.filter((r) => r.health === filters.health);
        if (q) rows = rows.filter((r) => `${r.ring} ${r.owner} ${r.bloodline}`.includes(q));
        const linkedAppeal = v.appealId ? store.getState().appeals.find((a) => a.id === v.appealId) : null;

        return (
          <section key={v.id} className="version-card">
            <header>
              <div>
                <h3>{fmtTime(v.at)} 版 · {v.reason}</h3>
                <p>
                  {v.event.location}　·　{km(v.event.distance)}　·　{v.event.weather}　·　司放 {formatClock(v.event.releaseTime)}
                </p>
              </div>
              {linkedAppeal && (
                <span className="badge cert-ok">关联申诉：{linkedAppeal.ring}（{linkedAppeal.status}）</span>
              )}
            </header>
            <div className="table-wrap">
              <table className="board-table compact">
                <thead>
                  <tr><th>名次</th><th>变化</th><th>足环号</th><th>鸽主</th><th>归巢时刻</th><th>分速</th><th>健康</th><th>证书</th><th>提醒</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const change = diff?.get(r.ring);
                    return (
                      <tr key={r.entryId} className={focusEntry === r.entryId ? "focus-row" : ""}>
                        <td>{r.rank === null ? "—" : r.pending ? <>待定<small>（原{r.rank}）</small></> : r.rank}</td>
                        <td><RankDelta before={change?.before ?? null} after={change?.after ?? null} /></td>
                        <td className="ring">{r.ring}</td>
                        <td>{r.owner}</td>
                        <td>{formatClock(r.homeTime)}</td>
                        <td className="speed">{formatSpeed(r.speed)}</td>
                        <td>{r.health}</td>
                        <td><CertBadge cert={r.cert} /></td>
                        <td className="reminders">{r.reminders.map((m) => <span key={m} className="reminder">{m}</span>)}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={9} className="empty">该版本下无符合筛选的记录</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {versions.length === 0 && <p className="empty-panel">还没有公示版本。</p>}
    </>
  );
}

function RankDelta({ before, after }: { before: number | null; after: number | null }) {
  if (before === after) return <span className="delta-same">—</span>;
  if (after === null) return <span className="delta-down">出榜</span>;
  if (before === null) return <span className="delta-up">新入榜 · 第{after}名</span>;
  if (after < before) return <span className="delta-up">▲ {before} → {after}</span>;
  return <span className="delta-down">▼ {before} → {after}</span>;
}

// ---------- 弹窗：赛事 ----------

function EventEditButton({ event }: { event: RaceEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>更正地点 / 距离 / 天气</button>
      {open && <EventModal event={event} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewEventButton({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>新建赛事</button>
      {open && <EventModal onCreated={(id) => { setOpen(false); onCreated(id); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function EventModal({ event, onClose, onCreated }: { event?: RaceEvent; onClose: () => void; onCreated?: (id: string) => void }) {
  const [name, setName] = useState(event?.name ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [distanceKm, setDistanceKm] = useState(event ? String(event.distance / 1000) : "");
  const [weather, setWeather] = useState(event?.weather ?? "");
  const [releaseTime, setReleaseTime] = useState(event?.releaseTime ?? "2026-09-24T06:00");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const distance = Math.round(Number(distanceKm) * 1000);
    if (!name.trim() || !location.trim() || !distance || distance <= 0) {
      setError("请完整填写名称、地点和正的距离");
      return;
    }
    try {
      if (event) {
        store.updateEventMeta(event.id, {
          name: name.trim(),
          location: location.trim(),
          distance,
          weather: weather.trim(),
          releaseTime,
        });
        onClose();
      } else {
        const id = store.addEvent({
          name: name.trim(),
          location: location.trim(),
          distance,
          weather: weather.trim(),
          releaseTime,
        });
        onCreated?.(id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={event ? "更正赛事信息（旧版留档）" : "新建赛事"} onClose={onClose}>
      <Field label="赛事名称"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="司放地点"><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <div className="field-row">
        <Field label="距离（公里）"><input type="number" step="0.1" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} /></Field>
        <Field label="司放时刻"><input type="datetime-local" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} /></Field>
      </div>
      <Field label="天气"><input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="如：晴，西北风 2 级" /></Field>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save}>{event ? "更正并重算留档" : "建立赛事"}</button>
      </div>
    </Modal>
  );
}

// ---------- 弹窗：登记 ----------

function EntryModal({
  event,
  mode,
  entry,
  onClose,
}: {
  event: RaceEvent;
  mode: "add" | "edit";
  entry?: Entry;
  onClose: () => void;
}) {
  const [ring, setRing] = useState(entry?.ring ?? "");
  const [owner, setOwner] = useState(entry?.owner ?? "");
  const [bloodline, setBloodline] = useState(entry?.bloodline ?? "");
  const [returned, setReturned] = useState(entry ? entry.homeTime !== null : true);
  const [homeTime, setHomeTime] = useState(entry?.homeTime ?? `${event.releaseTime.slice(0, 10)}T12:00`);
  const [health, setHealth] = useState<Health>(entry?.health ?? "健康");
  const [note, setNote] = useState(entry?.note ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const home = returned ? homeTime : null;
    try {
      if (mode === "add") {
        store.addEntry(event.id, {
          ring: ring.trim(),
          owner: owner.trim(),
          bloodline: bloodline.trim(),
          homeTime: home,
          health,
          note: note.trim(),
        });
      } else if (entry) {
        if (!reason.trim()) {
          setError("更正登记需写明更正依据");
          return;
        }
        const patch: EntryPatch = { homeTime: home, health, note: note.trim() };
        store.updateEntry(entry.id, patch, reason.trim());
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={mode === "add" ? "登记归巢 / 未归巢" : `更正登记 · ${entry?.ring}（旧版留档）`} onClose={onClose}>
      <div className="field-row">
        <Field label="足环号"><input value={ring} disabled={mode === "edit"} onChange={(e) => setRing(e.target.value)} /></Field>
        <Field label="鸽主"><input value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
        <Field label="血统"><input value={bloodline} onChange={(e) => setBloodline(e.target.value)} /></Field>
      </div>
      <Field label="归巢状态">
        <select value={returned ? "back" : "lost"} onChange={(e) => setReturned(e.target.value === "back")}>
          <option value="back">已归巢（填入归巢时刻）</option>
          <option value="lost">未归巢（不进速度榜）</option>
        </select>
      </Field>
      {returned && (
        <Field label="归巢时刻"><input type="datetime-local" value={homeTime} onChange={(e) => setHomeTime(e.target.value)} /></Field>
      )}
      <div className="field-row">
        <Field label="健康状态">
          <select value={health} onChange={(e) => setHealth(e.target.value as Health)}>
            {HEALTH_VALUES.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
      </div>
      <Field label="备注"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="健康备注、电子环情况……" /></Field>
      {mode === "edit" && (
        <Field label="更正依据（必填，记入轨迹）"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：核对鸽钟打印条" /></Field>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save}>{mode === "add" ? "登记" : "确认更正并重算"}</button>
      </div>
    </Modal>
  );
}

// ---------- 弹窗：发起申诉 ----------

function AppealModal({ event, entry, onClose }: { event: RaceEvent; entry: Entry; onClose: () => void }) {
  const [reason, setReason] = useState<Appeal["reason"]>("报时更正");
  const [detail, setDetail] = useState("");
  const [setHome, setSetHome] = useState(false);
  const [homeTime, setHomeTime] = useState(entry.homeTime ?? "");
  const [setHealth2, setSetHealth2] = useState(false);
  const [health, setHealth2v] = useState<Health>(entry.health);
  const [setNote2, setSetNote2] = useState(false);
  const [note, setNote] = useState(entry.note);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!detail.trim()) {
      setError("请填写鸽主陈述与凭证说明");
      return;
    }
    const proposal: EntryPatch = {};
    if (setHome) {
      if (!homeTime || homeTime <= event.releaseTime) {
        setError("期望归巢时刻需晚于司放时刻");
        return;
      }
      proposal.homeTime = homeTime;
    }
    if (setHealth2) proposal.health = health;
    if (setNote2) proposal.note = note;
    if (Object.keys(proposal).length === 0) {
      setError("至少选择一项申请更正内容");
      return;
    }
    try {
      store.openAppeal(event.id, entry.id, reason, detail.trim(), proposal);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={`发起申诉 · ${entry.ring}`} onClose={onClose}>
      <p className="modal-context">
        当前：归巢 {formatClock(entry.homeTime)} ｜ 健康 {entry.health} ｜ 备注 {entry.note || "（空）"}
      </p>
      <Field label="申诉类型">
        <select value={reason} onChange={(e) => setReason(e.target.value as Appeal["reason"])}>
          <option value="报时更正">报时更正（鸽钟/报到时间）</option>
          <option value="健康备注">健康备注更正</option>
          <option value="其他">其他</option>
        </select>
      </Field>
      <Field label="鸽主陈述与凭证">
        <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="如：持鸽钟打印条，电子环上传延迟……" />
      </Field>

      <div className="proposal-edit">
        <label className="checkline">
          <input type="checkbox" checked={setHome} onChange={(e) => setSetHome(e.target.checked)} />
          申请更正归巢时刻
          {setHome && <input type="datetime-local" value={homeTime} onChange={(e) => setHomeTime(e.target.value)} />}
        </label>
        <label className="checkline">
          <input type="checkbox" checked={setHealth2} onChange={(e) => setSetHealth2(e.target.checked)} />
          申请更正健康状态
          {setHealth2 && (
            <select value={health} onChange={(e) => setHealth2v(e.target.value as Health)}>
              {HEALTH_VALUES.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
        </label>
        <label className="checkline">
          <input type="checkbox" checked={setNote2} onChange={(e) => setSetNote2(e.target.checked)} />
          申请更正备注
          {setNote2 && <input value={note} onChange={(e) => setNote(e.target.value)} />}
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      <p className="foot-note">提交后该羽在本场标记“待定”、停发证书，须两名复核员均判改判才会更新成绩。</p>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>提交申诉</button>
      </div>
    </Modal>
  );
}

// ---------- 基础组件 ----------

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <header><h3>{title}</h3><button className="close" onClick={onClose}>✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <article className={`stat ${tone ?? ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

export default App;

const versionParts = (value) => value.slice(1).split(".").map(Number);
const compareVersions = (left, right) => {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

/** Validate explicit reservations across stage boundaries, without inventing unused patch numbers. */
export function validatePlanningReservations(document) {
  const tasks = [...document.matchAll(/^- \[([ x])\] ([A-Z]+-\d{3})｜([^\n]+)$/gmu)].map((match) => ({
    id: match[2], completed: match[1] === "x", text: match[3],
    status: /｜状态：([^｜]+)/u.exec(`｜${match[3]}`)?.[1],
    target: /｜目标版本：`?(V\d+\.\d+\.\d+|暂无)`?｜/u.exec(`｜${match[3]}`)?.[1],
    associations: /｜关联版本：([^｜]+)/u.exec(`｜${match[3]}`)?.[1] ?? "",
  }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("02-项目规划任务编号重复");
  for (const task of tasks) {
    if (!task.status || !task.target) throw new Error(`任务缺少状态或目标版本：${task.id}`);
    if ((task.status === "已完成") !== task.completed) throw new Error(`任务勾选与状态不一致：${task.id}`);
  }
  const rows = [...document.matchAll(/^\| (\d+) \| `(V\d+\.\d+\.\d+)` \| `([A-Z]+-\d{3})` \| ([^|]+) \| `([^`]+)` \|$/gmu)]
    .map((match) => ({ order: Number(match[1]), version: match[2], taskId: match[3], group: match[4].trim(), title: match[5] }));
  let previous = null;
  for (const row of rows) {
    if (row.order < 1 || (previous && (row.order <= previous.order || compareVersions(row.version, previous.version) <= 0))) {
      throw new Error(`版本或顺序重复/倒退：${row.version}`);
    }
    previous = row;
    const task = byId.get(row.taskId);
    if (!task) throw new Error(`版本分配缺少任务原件：${row.taskId}`);
    const group = row.taskId.split("-", 1)[0];
    if (row.group !== group || !row.title.startsWith(`${row.version} ${group} `) || !row.title.endsWith(`（${row.taskId}）`)) {
      throw new Error(`提交标题与任务/版本不一致：${row.title}`);
    }
    const exact = `\`${row.title}\``;
    const reserved = `预留 \`${row.version}\``;
    if (!task.associations.includes(exact) && (task.completed || !task.associations.includes(reserved))) {
      throw new Error(`任务关联版本不一致：${row.taskId}`);
    }
  }
  for (const task of tasks) {
    const allocated = rows.filter((row) => row.taskId === task.id);
    if (allocated.length && task.target !== allocated.at(-1).version) throw new Error(`任务目标版本不一致：${task.id}`);
    if (!allocated.length && task.target !== "暂无") throw new Error(`任务目标版本没有对应预留：${task.id}`);
  }
  if (tasks.length === 0 && (!/^\| 当前开发任务 \| 无 \|$/mu.test(document) || !/^\| 未完成版本任务 \| 无 \|$/mu.test(document))) {
    throw new Error("规划无任务时必须明确登记当前开发任务和未完成版本任务均为无");
  }
  return { taskCount: tasks.length, summary: rows.length ? `${rows[0].version}—${rows.at(-1).version}` : "no reserved commits" };
}

# 码头布局 JSON 格式（草案 v1）

样例：[`data/ppt_layout.sample.json`](../data/ppt_layout.sample.json)  
Schema：[`data/ppt_layout.schema.json`](../data/ppt_layout.schema.json)

## 1. 目标

- **一份文件描述整座码头**：陆地、岸线、码头、泊位、箱区、道路、船舶、大门。
- **适合手改**：坐标、尺寸、角度都是直观的米/度；不重复存可以由别处算出来的字段。
- **可直接导入**：校验通过后，转换成 Three.js 场景现有运行时数据结构，重建画面。
- **可往返**：从当前场景导出后，再导入应得到同一布局。

## 2. 坐标与单位

| 项 | 约定 |
|---|---|
| 单位 | 米 |
| 坐标系 | 本地 ENU：**+X 东、+Z 南、+Y 上** |
| 水面 | `Y = 0` |
| 码头面 | `meta.deck`，默认 `5.0` |
| 角度 | 度，绕 Y 轴；`0` 表示箱区/道路长轴指向 **+Z（南）** |
| 点 | `[x, z]` 两个数字 |

## 3. 顶层结构

```jsonc
{
  "format": "ppt-layout",
  "version": 1,
  "meta": { ... },
  "land": [[x, z], ...],
  "quay": { "pts": [[x, z], ...] },
  "terminals": [ ... ],
  "berths": [ ... ],
  "yards": [ ... ],
  "roads": { "front": [], "main": [], "lanes": [] },
  "vessels": [ ... ],
  "gate": { "x": 0, "z": 0, "angle": 0 }
}
```

必填：`format / version / meta / land / quay / terminals / berths / yards`。  
可选：`roads / vessels / gate`。

## 4. 对象字段

### meta

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 布局名称 |
| `origin` | 是 | `{lon, lat}` 经纬度原点，用于区域底图/卫星底图对齐 |
| `units` | 是 | 固定 `"m"` |
| `axes` | 否 | 坐标系说明，固定字符串 |
| `deck` | 是 | 码头面高度，默认 5.0 |
| `generated` | 否 | 导出时间/版本标记 |

### terminals

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `PPT1`…`PPT6`、`PPAT` |
| `name` | 否 | 显示名 |
| `color` | 是 | `#RRGGBB`，岸线压条/标签/IDs 底色 |
| `qc` | 是 | 岸桥数量（按该码头泊位均布） |
| `anchor` | 否 | 码头名牌位置 `[x,z]`；缺省用该码头箱区质心 |

### berths

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `B01`…`B41` |
| `terminal` | 是 | 所属码头 |
| `a` / `b` | 是 | 泊位两端点 `[x,z]`，必须落在同一直岸面上 |
| `depth` | 否 | 水深（米），默认 15 |
| `type` | 否 | `container` / `general` / `pasir`，默认 `container` |
| `normal` | 否 | 水域法线；缺省按 `a→b` 的垂直方向 + 陆地多边形自动取水侧 |
| `note` | 否 | 备注 |

### yards

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一 ID（导出时为 `Y###`） |
| `code` | 是 | 显示编号，`<terminal>-BLK###` |
| `terminal` | 是 | 所属码头 |
| `c` | 是 | 箱区中心 `[x,z]` |
| `w` / `l` | 是 | 宽（跨）/ 长（沿长轴） |
| `angle` | 是 | 长轴绕 Y 角度 |
| `rows` / `bays` / `tiers` | 是 | 排 / 贝 / 层 |
| `row_pitch` / `bay_pitch` / `tier_h` | 是 | 排距 / 贝距 / 层高 |
| `fill` | 是 | 0–1，箱区填充率 |
| `crane` | 是 | `RTG` / `RMG` / `OHBC` / `none` |
| `yc` | 否 | 0/1，是否放场桥 |
| `yc_t` | 否 | 场桥停在块端的位置，默认 -0.5 |
| `group` / `tag` | 否 | 内部编组，默认等于 `id` |

### roads

- `front`：前沿路，`{ id?, a, b, width }`
- `main`：主干路，`{ name?, cls?, width, pts: [[x,z], …] }`
- `lanes`：箱区车道，`{ a, b, width }`

宽度缺省：前沿 20 m、主干 24 m、车道 10 m。

### vessels

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `V1`… |
| `type` | 是 | `ULCV` / `Neo-Panamax` / `Feeder` / `PCTC` … |
| `loa` / `beam` | 是 | 船长 / 船宽 |
| `berth` | 是 | 靠泊泊位 ID |
| `color` | 否 | 船体颜色 |

### gate

`{ x, z, angle? }`，缺省不建大门。

## 5. 派生字段（不写进 JSON）

导入时由 `src/layout.js` 计算，避免手改时出现两份真值：

| 运行时字段 | 来源 |
|---|---|
| `berths[].mid` | `a/b` 中点 |
| `berths[].length` | `|a-b|` |
| `berths[].heading` | `a→b` 方位角 |
| `berths[].normal` | 垂直于 `a-b`，用陆地多边形选水侧；可用 `normal` 覆盖 |
| `terminals[].berths` | 按 `berth.terminal` 分组，按泊位号排序 |
| `terminals[].n` / `quay` / `berth_range` | 由泊位数与泊位长度求和 |
| `terminals[].anchor` | 缺省取该码头箱区质心 |
| `yards[].group` / `tag` | 缺省等于 `id` |
| `meta.berths` / `quay_cranes` / `yards` | 由数组长度汇总 |

## 6. 导入流程

1. 读取文件，`JSON.parse`；检查 `format === "ppt-layout"`、`version === 1`。
2. 内置校验必填字段、类型、ID/编号唯一性与引用关系；需要更严格的检查时用 `ppt_layout.schema.json` 做外部 Schema 校验。
3. 归一化：
   - 点统一成 `[x,z]` 数字；
   - 角度归一化到 `[-180,180)`；
   - 颜色补 `#`；
   - 缺省宽度/深度/`yc_t`/`type` 填默认值。
4. 派生第 5 节字段。
5. 写入运行时 `data`，重建场景（或存到 `localStorage` 后刷新）。
6. 导入失败时保留当前场景，弹出具体字段路径（如 `yards[2].bays`）。

## 7. 导出流程

- 从当前运行时 `data` 反向取第 4 节字段；
- **丢弃**派生字段、ID 标签、动画状态、相机位置；
- 保留 `roads` 三段、`vessels`、`gate`；
- 导出文件名：`ppt-layout-YYYYMMDD-HHmm.json`；
- 导出后可直接手改再导入。

## 8. 汉堡菜单（已实现）

右上角总菜单按钮（☰），展开：

- **导出码头布局**：从当前运行时 `data` 生成紧凑 JSON 并下载；
- **导入码头布局**：选择 JSON → 内置校验 → 写入 `localStorage` → 刷新重建；
- **下载样例**：下载 `ppt_layout.sample.json`；
- **恢复默认布局**：清除本地导入，回到 `data/ppt_terminal.json`。

实现细节：

- 导入文件放在 `localStorage['ppt.layout.v1']`；刷新后 `src/main.js` 优先读它，没有才 fetch 默认数据；
- 导入失败只显示错误，不写存储、不刷新，当前场景保持不变；
- 菜单里的导入/导出逻辑在 `src/main.js`，格式转换在 `src/layout.js`；
- 内置校验覆盖 `format/version`、必填字段、ID/编号唯一性、terminal 引用、vessel→berth 引用；`ppt_layout.schema.json` 用于更严格的外部校验。

> 需求里两个子菜单都写成“导出码头布局”，按语义第二个实现为“导入码头布局”。

## 9. 样例说明

样例是一个 620 × 340 m 的虚构小码头，但覆盖全部对象类型：

- 2 个码头（PPT1 / PPT2）、2 个泊位；
- 3 个箱区（RTG / RMG，含 `yc` 0/1）；
- 3 类道路（前沿 / 主干 / 车道）；
- 2 艘船、1 个大门；
- 陆地、岸线各一段。

它的目的不是还原 PPT，而是让“手改—导入—显示”这条链路可以完整跑通；真实导出会包含 6 个码头、41 个泊位、666 个箱区、53 条车道等全部内容。

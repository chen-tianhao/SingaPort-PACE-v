import * as THREE from 'three';

/**
 * Compact layout JSON <-> runtime scene data.
 *
 * The file stores only source-of-truth numbers.  Everything the renderer needs
 * but can be recomputed (berth midpoint/heading/normal, terminal ranges and
 * anchors, yard group defaults, meta totals) is derived here on import.
 */

export const LAYOUT_FORMAT = 'ppt-layout';
export const LAYOUT_VERSION = 1;
export const LAYOUT_STORAGE_KEY = 'ppt.layout.v1';

const DEFAULT_TERM_COLOR = '#7f8a92';

const pt = (p) => [Number(p[0]), Number(p[1])];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if ((zi > p[1]) !== (zj > p[1])) {
      const x = xi + ((p[1] - zi) * (xj - xi)) / (zj - zi);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

function normalFor(a, b, poly, forced) {
  if (Array.isArray(forced) && forced.length === 2) {
    const L = Math.hypot(forced[0], forced[1]) || 1;
    return [forced[0] / L, forced[1] / L];
  }
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const n1 = [-dz / L, dx / L];
  const n2 = [dz / L, -dx / L];
  const c = mid(a, b);
  const o1 = !pointInPoly([c[0] + n1[0] * 8, c[1] + n1[1] * 8], poly);
  const o2 = !pointInPoly([c[0] + n2[0] * 8, c[1] + n2[1] * 8], poly);
  if (o1 && !o2) return n1;
  if (o2 && !o1) return n2;
  // fallback: point away from the polygon centroid
  let cx = 0, cz = 0;
  for (const q of poly) { cx += q[0]; cz += q[1]; }
  cx /= poly.length; cz /= poly.length;
  return (c[0] - cx) * n1[0] + (c[1] - cz) * n1[1] >= 0 ? n1 : n2;
}

function rangeText(ids) {
  const nums = ids.map((id) => Number(String(id).replace(/\D/g, ''))).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return '';
  const prefix = String(ids[0]).replace(/\d+$/, '');
  const out = [];
  let s = nums[0], prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n !== prev + 1) {
      out.push(s === prev ? `${prefix}${String(s).padStart(2, '0')}` : `${prefix}${String(s).padStart(2, '0')}–${String(prev).padStart(2, '0')}`);
      s = n;
    }
    prev = n;
  }
  return out.join(' + ');
}

function centroid(points) {
  if (!points.length) return [0, 0];
  let x = 0, z = 0;
  for (const p of points) { x += p[0]; z += p[1]; }
  return [x / points.length, z / points.length];
}

export function toLayout(data) {
  const quay = data.quay_chains?.[0]?.pts || [];
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    meta: {
      name: data.meta?.name || 'PPT layout',
      origin: data.meta?.origin || { lon: 103.76, lat: 1.28 },
      units: 'm',
      axes: '+X east, +Z south, +Y up',
      deck: data.meta?.deck ?? 5,
      generated: new Date().toISOString().slice(0, 10),
    },
    land: (data.land || []).map(pt),
    quay: { pts: quay.map(pt) },
    terminals: (data.terminals || []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color || DEFAULT_TERM_COLOR,
      qc: t.qc ?? 0,
      ...(t.anchor ? { anchor: pt(t.anchor) } : {}),
    })),
    berths: (data.berths || []).map((b) => ({
      id: b.id,
      terminal: b.terminal,
      a: pt(b.a),
      b: pt(b.b),
      depth: b.depth ?? 15,
      type: b.type || 'container',
      ...(b.normal ? { normal: [Number(b.normal[0]), Number(b.normal[1])] } : {}),
    })),
    yards: (data.yards || []).map((y) => ({
      id: y.id,
      code: y.code,
      terminal: y.terminal,
      c: pt(y.c),
      w: y.w,
      l: y.l,
      angle: y.angle,
      rows: y.rows,
      bays: y.bays,
      tiers: y.tiers,
      row_pitch: y.row_pitch,
      bay_pitch: y.bay_pitch,
      tier_h: y.tier_h,
      fill: y.fill,
      crane: y.crane || 'RTG',
      yc: y.yc ? 1 : 0,
      ...(y.yc_t !== undefined ? { yc_t: y.yc_t } : {}),
    })),
    roads: {
      front: (data.roads || []).map((r) => ({
        id: r.id,
        a: pt(r.a),
        b: pt(r.b),
        width: r.width ?? 20,
      })),
      main: (data.mainRoads || []).map((r) => ({
        name: r.name,
        cls: r.cls,
        width: r.width ?? 24,
        pts: r.pts.map(pt),
      })),
      lanes: (data.yardLanes || []).map((r) => ({
        a: pt(r.a),
        b: pt(r.b),
        width: r.width ?? 10,
      })),
    },
    vessels: (data.vessels || []).map((v) => ({
      id: v.id,
      type: v.type,
      loa: v.loa,
      beam: v.beam,
      berth: v.berth,
      ...(v.color ? { color: v.color } : {}),
    })),
    ...(data.gate ? { gate: { x: data.gate.x, z: data.gate.z, angle: data.gate.rot ?? 0 } } : {}),
  };
}

export function fromLayout(layout) {
  const land = (layout.land || []).map(pt);
  const quayPts = (layout.quay?.pts || []).map(pt);
  const berths = (layout.berths || []).map((b, i) => {
    const a = pt(b.a), c = pt(b.b);
    const m = mid(a, c);
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    return {
      id: b.id,
      terminal: b.terminal,
      phase: b.terminal,
      chain: 'QUAY',
      chain_name: 'Imported layout',
      index: i + 1,
      length: Math.round(len),
      len_model: Math.round(len * 10) / 10,
      depth: b.depth ?? 15,
      type: b.type || 'container',
      a, b: c, mid: m,
      normal: normalFor(a, c, land, b.normal),
      heading: Math.atan2(dx, -dz) * 180 / Math.PI,
    };
  });
  const byId = new Map(berths.map((b) => [b.id, b]));
  const yards = (layout.yards || []).map((y) => ({
    ...y,
    c: pt(y.c),
    group: y.group || y.id,
    tag: y.tag || 'C',
    yc: y.yc ? 1 : 0,
    yc_t: y.yc_t ?? -0.5,
  }));
  const terminals = (layout.terminals || []).map((t) => {
    const list = berths.filter((b) => b.terminal === t.id).sort((a, b) => a.id.localeCompare(b.id));
    const own = yards.filter((y) => y.terminal === t.id);
    const anchor = t.anchor ? pt(t.anchor) : (own.length ? centroid(own.map((y) => y.c)) : centroid(list.map((b) => b.mid)));
    return {
      id: t.id,
      name: t.name || t.id,
      color: t.color || DEFAULT_TERM_COLOR,
      berth_range: rangeText(list.map((b) => b.id)),
      berths: list.map((b) => b.id),
      n: list.length,
      quay: Math.round(list.reduce((s, b) => s + b.length, 0)),
      qc: t.qc ?? 0,
      anchor: [Math.round(anchor[0]), Math.round(anchor[1])],
    };
  });
  const quayLen = quayPts.slice(1).reduce((s, p, i) => s + dist(quayPts[i], p), 0);
  const gate = layout.gate ? {
    x: layout.gate.x,
    z: layout.gate.z,
    in_lanes: layout.gate.in_lanes ?? 14,
    out_lanes: layout.gate.out_lanes ?? 8,
    lane_w: layout.gate.lane_w ?? 4.2,
    canopy_h: layout.gate.canopy_h ?? 7.5,
    rot: layout.gate.angle ?? layout.gate.rot ?? -0.2,
  } : {
    x: Math.round(centroid(land)[0]),
    z: Math.round(centroid(land)[1]),
    in_lanes: 14,
    out_lanes: 8,
    lane_w: 4.2,
    canopy_h: 7.5,
    rot: 0,
  };

  return {
    meta: {
      name: layout.meta?.name || 'Imported layout',
      name_zh: '导入布局',
      operator: 'Imported JSON',
      origin: layout.meta?.origin || { lon: 103.76, lat: 1.28 },
      frame: 'local ENU metres: +X east, +Z south, +Y up, water Y=0',
      units: 'm',
      deck: 5,
      generated: layout.meta?.generated,
      berths: berths.length,
      quay_cranes: terminals.reduce((s, t) => s + (t.qc || 0), 0),
      yards: yards.length,
      quay_chain_m: Math.round(quayLen),
      quay_length: Math.round(berths.reduce((s, b) => s + b.length, 0)),
      custom: true,
    },
    land,
    quay_chains: [{ id: 'QUAY', name: 'Imported quay', pts: quayPts }],
    terminals,
    berths,
    yards,
    roads: (layout.roads?.front || []).map((r, i) => ({
      id: r.id || `R${i + 1}`,
      a: pt(r.a), b: pt(r.b),
      width: r.width ?? 20,
      type: 'quay',
    })),
    mainRoads: (layout.roads?.main || []).map((r, i) => ({
      name: r.name || `Main ${i + 1}`,
      cls: r.cls || 'main',
      width: r.width ?? 24,
      pts: (r.pts || []).map(pt),
    })),
    yardLanes: (layout.roads?.lanes || []).map((r) => ({
      a: pt(r.a), b: pt(r.b), width: r.width ?? 10,
    })),
    vessels: (layout.vessels || []).map((v) => ({
      id: v.id,
      type: v.type || 'Feeder',
      loa: v.loa,
      beam: v.beam,
      draft: v.draft ?? Math.max(8, Math.round(v.loa * 0.04)),
      berth: v.berth,
      color: v.color || '#2f4d6b',
    })),
    gate,
    channels: [],
    anchorages: [],
  };
}

export function validateLayout(layout) {
  const errs = [];
  if (!layout || typeof layout !== 'object') return ['文件不是 JSON 对象'];
  if (layout.format !== LAYOUT_FORMAT) errs.push('format 必须是 "ppt-layout"');
  if (layout.version !== LAYOUT_VERSION) errs.push(`version 必须是 ${LAYOUT_VERSION}`);
  if (!layout.meta || typeof layout.meta !== 'object') errs.push('缺少 meta');
  if (!Array.isArray(layout.land) || layout.land.length < 3) errs.push('land 至少 3 个点');
  if (!Array.isArray(layout.quay?.pts) || layout.quay.pts.length < 2) errs.push('quay.pts 至少 2 个点');
  if (!Array.isArray(layout.terminals) || !layout.terminals.length) errs.push('terminals 不能为空');
  if (!Array.isArray(layout.berths) || !layout.berths.length) errs.push('berths 不能为空');
  if (!Array.isArray(layout.yards)) errs.push('yards 必须是数组');

  const termIds = new Set();
  for (const [i, t] of (layout.terminals || []).entries()) {
    if (!t.id) errs.push(`terminals[${i}].id 缺失`);
    else if (termIds.has(t.id)) errs.push(`terminals[${i}].id 重复：${t.id}`);
    else termIds.add(t.id);
    if (!/^#[0-9a-f]{6}$/i.test(t.color || '')) errs.push(`terminals[${i}].color 必须是 #RRGGBB`);
  }
  const berthIds = new Set();
  for (const [i, b] of (layout.berths || []).entries()) {
    if (!b.id) errs.push(`berths[${i}].id 缺失`);
    else if (berthIds.has(b.id)) errs.push(`berths[${i}].id 重复：${b.id}`);
    else berthIds.add(b.id);
    if (!termIds.has(b.terminal)) errs.push(`berths[${i}].terminal 不存在：${b.terminal}`);
    if (!Array.isArray(b.a) || !Array.isArray(b.b)) errs.push(`berths[${i}] 缺少 a/b`);
  }
  const codes = new Set();
  for (const [i, y] of (layout.yards || []).entries()) {
    if (!y.id) errs.push(`yards[${i}].id 缺失`);
    if (!y.code) errs.push(`yards[${i}].code 缺失`);
    else if (codes.has(y.code)) errs.push(`yards[${i}].code 重复：${y.code}`);
    else codes.add(y.code);
    if (!termIds.has(y.terminal)) errs.push(`yards[${i}].terminal 不存在：${y.terminal}`);
    if (!(y.w > 0) || !(y.l > 0)) errs.push(`yards[${i}] w/l 必须大于 0`);
  }
  for (const [i, v] of (layout.vessels || []).entries()) {
    if (!berthIds.has(v.berth)) errs.push(`vessels[${i}].berth 不存在：${v.berth}`);
  }
  return errs;
}

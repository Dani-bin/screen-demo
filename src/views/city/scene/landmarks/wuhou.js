/*
 * 武侯祠·锦里（占位）
 * ----------------------------------------------------------
 * 精细模型待实现：规格见 docs/superpowers/specs/2026-09-30-city-new-landmarks-design.md。
 * 占位期间不替换任何 OSM 楼，城市里仍显示通用方盒楼。
 */

/**
 * 构建景点（实现后签名为 build(ctx)，ctx = { project, buildings, theme, spot }）。
 * @returns {{ meshes: Array, zones: Array, markerHeight: number, walkways: Array }}
 */
export function build() {
  return { meshes: [], zones: [], markerHeight: 0, walkways: [] }
}

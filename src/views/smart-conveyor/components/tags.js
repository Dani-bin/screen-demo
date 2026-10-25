/*
 * 小标签（函数式组件）：告警等级、人机料环四维、设备状态点
 * 状态色只表示状态，并且总配文字（dataviz：不只靠颜色）
 */
import { h } from "vue"
import { DIM, LV, LV_VAR, ST_NAME, ST_VAR } from "./ui.js"

const cvar = (v) => ({ "--c": `var(${v})` })

/** 告警等级：一级…四级 */
export const LvTag = (props) =>
  h("span", { class: "lv", style: cvar(LV_VAR[props.l]) }, LV[props.l])
LvTag.props = ["l"]

/** 四维：人 / 机 / 料 / 环 */
export const DimTag = (props) =>
  h("span", { class: "dim", style: cvar(DIM[props.k][1]) }, DIM[props.k][0])
DimTag.props = ["k"]

/** 设备状态：圆点 + 状态名 */
export const StDot = (props) =>
  h("span", { class: "st", style: cvar(ST_VAR[props.st]) }, [
    h("i"),
    ST_NAME[props.st]
  ])
StDot.props = ["st"]

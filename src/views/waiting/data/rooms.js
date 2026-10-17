/*
 * 内科候诊区 · 诊室配置（静态数据）
 * ----------------------------------------------------------
 * 2F 南排 8 间诊室，顺序即大屏上从左到右的排列顺序。
 *   no     房间号（字符串，与 /hospital 的房间号一致）
 *   dept   诊室全称（诊室牌上显示）
 *   short  科室简称（叫号条、最近叫号卡片上显示）
 *   doctor 出诊医生
 *   title  医生职称
 *   color  科室主题色（同科室的两间诊室同色）
 */

export const ROOMS = [
  {
    no: "213",
    dept: "内分泌科",
    short: "内分泌",
    doctor: "周文静",
    title: "主治医师",
    color: "#FFE27A"
  },
  {
    no: "214",
    dept: "神经内科",
    short: "神经内科",
    doctor: "何建平",
    title: "副主任医师",
    color: "#D9B8FF"
  },
  {
    no: "215",
    dept: "消化内科诊室 1",
    short: "消化内科",
    doctor: "林海涛",
    title: "主任医师",
    color: "#9EE6C0"
  },
  {
    no: "216",
    dept: "消化内科诊室 2",
    short: "消化内科",
    doctor: "李明华",
    title: "副主任医师",
    color: "#9EE6C0"
  },
  {
    no: "217",
    dept: "呼吸内科诊室 1",
    short: "呼吸内科",
    doctor: "陈志远",
    title: "主任医师",
    color: "#9CCBFF"
  },
  {
    no: "218",
    dept: "呼吸内科诊室 2",
    short: "呼吸内科",
    doctor: "刘雅琴",
    title: "主治医师",
    color: "#9CCBFF"
  },
  {
    no: "219",
    dept: "心内科诊室 1",
    short: "心内科",
    doctor: "王国栋",
    title: "主任医师",
    color: "#FFA8A0"
  },
  {
    no: "220",
    dept: "心内科诊室 2",
    short: "心内科",
    doctor: "赵蕾",
    title: "副主任医师",
    color: "#FFA8A0"
  }
]

/**
 * 各诊室开屏时的「平均等候」初值（分钟）。
 * 仿真用它填满每间诊室的等候时长滚动窗口，之后随真实叫号逐步滚动更新
 */
export const AVG_WAIT_SEED = {
  213: 14,
  214: 22,
  215: 26,
  216: 31,
  217: 19,
  218: 24,
  219: 28,
  220: 17
}

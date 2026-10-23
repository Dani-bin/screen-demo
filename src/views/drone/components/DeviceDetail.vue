<!--
  设备详情：选中机场 / 无人机 / 巡检对象时弹出。顶部是从当前 GLB 里截取的这台设备的模型缩略图，
  下面列这台设备的全部参数（机场：状态、舱盖、气象、数据质量、今日架次；无人机：位置、高度、速度、电量、
  相机、RTK、今日时长 / 里程；巡检对象：今日相关事件）。在飞的无人机可以"跟随视角"。
-->
<template>
  <div class="detail panel">
    <div class="ph">
      <h3>{{ title }}</h3>
      <span class="close" @click="$emit('close')">×</span>
    </div>
    <div
      class="thumb"
      :style="thumb ? { backgroundImage: `url(${thumb})` } : {}"
    >
      <span class="tag">{{ id }}</span>
    </div>
    <dl>
      <template v-for="r in rows" :key="r[0]">
        <dt>{{ r[0] }}</dt>
        <dd :class="r[2]">{{ r[1] }}</dd>
      </template>
    </dl>
    <div v-if="canFollow" class="acts">
      <span class="btn" @click="$emit('follow', droneId)">{{
        following ? "退出跟随" : "跟随视角"
      }}</span>
    </div>
  </div>
</template>

<script setup>
  import {
    DOCK_STATE,
    DRONE_STATE,
    EVENT_STATUS,
    EVENT_TYPES,
    RAIN_LEVEL
  } from "../data/catalog.js"
  import { DOCKS, DRONES, TARGETS } from "../data/layout.js"
  import { compass, hms, mmss } from "../utils.js"

  const props = defineProps({
    id: { type: String, required: true },
    state: { type: Object, required: true },
    thumb: { type: String, default: null },
    following: { type: Boolean, default: false }
  })
  defineEmits(["close", "follow"])

  const isDock = computed(() => !!DOCKS[props.id])
  const isDrone = computed(() => !!DRONES[props.id])
  const droneId = computed(() =>
    isDrone.value ? props.id : isDock.value ? DOCKS[props.id].drone : null
  )
  const canFollow = computed(
    () => droneId.value && props.state.drones[droneId.value].state !== "docked"
  )
  const title = computed(() =>
    isDock.value
      ? DOCKS[props.id].name
      : isDrone.value
        ? DRONES[props.id].name
        : TARGETS[props.id]?.name || props.id
  )

  const rows = computed(() => {
    const s = props.state
    if (isDock.value) {
      const d = s.docks[props.id]
      const u = s.drones[DOCKS[props.id].drone]
      return [
        [
          "状态",
          d.online ? DOCK_STATE[d.state] : `离线 ${mmss(d.age)}`,
          d.online ? "" : "off"
        ],
        [
          "能否起飞",
          d.canFly ? "可以" : `不可起飞 · ${d.blockReason}`,
          d.canFly ? "ok" : "warn"
        ],
        ["配套无人机", `${u.id} · 电量 ${u.battery.toFixed(0)}%`],
        [
          "舱内温湿度",
          `${d.cabinTemp.toFixed(1)} ℃ · ${d.cabinHum.toFixed(0)} %RH`
        ],
        [
          "风速 / 阵风",
          `${d.wind.toFixed(1)} / ${d.gust.toFixed(1)} m/s · ${d.windLevel} 级`,
          d.gust >= 12 ? "warn" : ""
        ],
        ["风向（估算）", `${compass(d.windDir)}风 ${Math.round(d.windDir)}°`],
        [
          "雨量 · 温湿度",
          `${RAIN_LEVEL[d.rain]} · ${d.temp.toFixed(1)} ℃ · ${d.humidity.toFixed(0)} %RH`
        ],
        [
          "今日架次",
          `${d.sorties}（计划 ${d.planSorties} · 复核 ${d.reviewSorties}）`
        ],
        [
          "数据",
          d.q === "good"
            ? `正常 · ${d.age.toFixed(0)} s 前`
            : `最后在线 ${hms(d.lastSeen)}`,
          d.q === "good" ? "" : "warn"
        ]
      ]
    }
    if (isDrone.value) {
      const u = s.drones[props.id]
      return [
        ["状态", DRONE_STATE[u.state]],
        ["任务", u.sortie || "—"],
        ["相对高度", `${u.altRel.toFixed(0)} m`],
        [
          "水平速度 · 航向",
          `${u.speed.toFixed(1)} m/s · ${Math.round(u.heading)}°`
        ],
        [
          "电量 · 剩余航时",
          `${u.battery.toFixed(0)}% · ${u.remainMin.toFixed(0)} min`,
          u.battery < 30 ? "warn" : ""
        ],
        ["相机", u.cam === "ir" ? "红外热成像" : "可见光"],
        [
          "定位",
          u.rtk === "float" ? "RTK 浮点解（位置不确定）" : "RTK 固定解",
          u.rtk === "float" ? "warn" : ""
        ],
        ["园区坐标", `${u.x.toFixed(0)}, ${u.y.toFixed(0)}`],
        [
          "今日飞行",
          `${u.flightMin.toFixed(0)} min · ${u.distanceKm.toFixed(1)} km`
        ],
        ["登记号", DRONES[props.id].reg]
      ]
    }
    const tg = TARGETS[props.id]
    const evs = s.events.filter(
      (e) => e.target === props.id || TARGETS[e.target]?.group === props.id
    )
    return [
      [
        "类型",
        {
          tank: "储罐",
          sphere: "球罐",
          unit: "生产装置",
          piperack: "管廊",
          utility: "公用工程",
          warehouse: "仓库",
          flare: "火炬",
          office: "办公",
          parking: "停车场",
          gate: "卡口",
          perimeter: "周界",
          loading: "装卸站",
          jetty: "码头"
        }[tg?.kind] || "—"
      ],
      ["责任部门", tg?.unit || "—"],
      ["所在片区", tg?.zone || "—"],
      ["今日事件", evs.length ? `${evs.length} 条` : "无"],
      ...evs
        .slice(0, 3)
        .map((e) => [
          hms(e.detectedAt, false),
          `${EVENT_TYPES[e.type].label} · ${EVENT_STATUS[e.status]}`,
          e.status === "pending" ? "warn" : ""
        ])
    ]
  })
</script>

<style lang="scss" scoped>
  .detail {
    position: absolute;
    left: 440px;
    top: 250px;
    width: 300px;
    z-index: 6;
    padding-bottom: 10px;
  }
  .close {
    font-size: 20px;
    cursor: pointer;
    color: var(--sub);
  }
  .thumb {
    position: relative;
    height: 150px;
    margin: 0 12px 8px;
    border-radius: 3px;
    background: #0d1626 center / cover no-repeat;
    .tag {
      position: absolute;
      left: 6px;
      top: 6px;
      font-size: 11px;
      padding: 1px 6px;
      background: rgba(0, 0, 0, 0.55);
      border-radius: 2px;
    }
  }
  dl {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 6px 8px;
    margin: 0 14px;
    font-size: 12px;
  }
  dt {
    color: var(--sub);
  }
  dd {
    color: var(--text);
    &.warn {
      color: var(--warn);
    }
    &.off {
      color: var(--off);
    }
    &.ok {
      color: var(--ok);
    }
  }
  .acts {
    margin: 10px 14px 0;
  }
  .btn {
    display: block;
    height: 28px;
    line-height: 28px;
    text-align: center;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 3px;
    cursor: pointer;
  }
</style>

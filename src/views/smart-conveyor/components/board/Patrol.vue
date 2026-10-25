<!--
  10 巡检机器人 · 人员定位：两台吊轨机器人 + 地面机器狗（状态、在所巡皮带上的位置、电量）；
  井下人数、工作面 / 皮带沿线人数、UWB 基站在线数；离线基站标"覆盖人数过期"
-->
<template>
  <Panel no="10" title="巡检机器人 · 人员定位" en="ROBOTS · UWB">
    <div class="rb">
      <div v-for="r in robots" :key="r.id" class="rb-i">
        <Ic :name="r.icon" />
        <div>
          <b class="code">{{ r.id }}</b
          ><span>{{ r.name }}</span>
        </div>
        <em :class="{ on: r.x.state !== 'charging' }">{{ r.x.stateName }}</em>
        <div class="rb-pos">
          <i :style="{ left: `${((r.x.pos / r.L) * 100).toFixed(0)}%` }"></i>
        </div>
        <strong>{{ fmt(r.x.battery) }}%</strong>
      </div>
    </div>
    <div class="ppl">
      <div class="ppl-n">
        <Ic name="user" /><b>{{ fmt(f.s.kpi.peopleUnderground) }}</b
        ><span>人</span>
        <div class="ppl-a">
          <span v-for="a in areas" :key="a[0]"
            >{{ a[0] }} <b>{{ a[1] }}</b></span
          ><span
            >UWB 基站
            <b>{{ f.uwb.length - offline.length }}/{{ f.uwb.length }}</b></span
          >
        </div>
      </div>
      <div v-for="u in offline" :key="u.id" class="stale">
        <Ic name="pin" /><b class="code">{{ u.id }}</b
        ><span>离线 · 覆盖人数过期</span><em>最后验证 {{ hms(u.offSince) }}</em>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt, hms } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ f: { type: Object, required: true } })

  const L = (id) => layout.belts.find((b) => b.id === id).L
  /** [编号, 名称, 图标, 巡检的皮带] */
  const ROBOTS = [
    ["RB01", "主斜井吊轨", "robot", "BC02"],
    ["RB02", "大巷吊轨", "robot", "BC03"],
    ["DOG01", "地面机器狗", "dog", "BC01"]
  ]
  const robots = computed(() =>
    ROBOTS.map(([id, name, icon, belt]) => ({
      id,
      name,
      icon,
      L: L(belt),
      x: props.f.s.robots[id]
    }))
  )
  const areas = computed(() => {
    const p = props.f.people
    return [
      ["工作面", (p.WF12301 || 0) + (p.WF12305 || 0)],
      [
        "皮带沿线",
        ["BC02", "BC03", "BC04", "BC05", "BC06"].reduce(
          (a, k) => a + (p[k] || 0),
          0
        )
      ]
    ]
  })
  const offline = computed(() => props.f.uwb.filter((u) => !u.online))
</script>

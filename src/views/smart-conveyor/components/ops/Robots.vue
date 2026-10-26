<!--
  O4 巡检机器人：两台吊轨机器人 + 地面机器狗的状态、电量、本趟任务进度、今日巡检里程、所巡皮带上发现的问题数；
  点一台三维跟到它所在位置
-->
<template>
  <Panel no="M4" title="巡检机器人" en="INSPECTION ROBOTS">
    <div class="rb2">
      <div
        v-for="r in rows"
        :key="r.id"
        class="rb2-i"
        @click="emit('follow', r)"
      >
        <header>
          <Ic :name="r.icon" /><b class="code">{{ r.id }}</b
          ><span>{{ r.name }}</span
          ><em :class="r.x.state">{{ r.x.stateName }}</em>
        </header>
        <div class="rb2-m">
          <div>
            <span>电量</span
            ><b :class="{ low: r.x.battery < 30 }">{{ fmt(r.x.battery) }}%</b>
          </div>
          <div>
            <span>今日里程</span><b>{{ fmt(r.km, 1) }}<i>km</i></b>
          </div>
          <div>
            <span>发现问题</span><b :class="{ pred: r.found }">{{ r.found }}</b>
          </div>
        </div>
        <div class="rb2-p">
          <div class="bar">
            <i :style="{ width: `${(r.prog * 100).toFixed(0)}%` }"></i>
          </div>
          <em>{{ r.progText }}</em>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt, hm } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const emit = defineEmits(["follow"])
  const HOUR = 3600000

  const ROBOTS = [
    ["RB01", "主斜井吊轨", "robot", "BC02"],
    ["RB02", "大巷吊轨", "robot", "BC03"],
    ["DOG01", "地面机器狗", "dog", "BC01"]
  ]
  const rows = computed(() =>
    ROBOTS.map(([id, name, icon, belt]) => {
      const d = layout.devices.find((x) => x.id === id)
      const x = props.f.s.robots[id]
      const [a, z] = d.chainage
      const len = z - a
      // 今日已出发的趟数（吊轨每 2 h 一趟、机器狗 5 趟）× 往返里程
      const starts =
        icon === "dog"
          ? [9.25, 12.25, 15.25, 18.25, 21.25]
          : Array.from({ length: 12 }, (_, k) => 0.33 + 2 * k)
      const done = starts.filter(
        (h) => props.w.d0 + h * HOUR <= props.f.ms
      ).length
      const km = (done * 2 * len) / 1000
      const found = props.f.s.tracks.filter(
        (t) => t.belt === belt && t.s >= 0.35
      ).length
      let prog = 1
      let progText = "充电中"
      if (x.mission?.points) {
        prog = x.mission.point / x.mission.points
        progText = `定点 ${x.mission.point}/${x.mission.points} · 可见光 + 红外 + 拾音`
      } else if (x.state === "return") {
        prog = 1
        progText = "巡检完成，返回机头充电"
      } else {
        const next = starts.find((h) => props.w.d0 + h * HOUR > props.f.ms)
        progText =
          next != null
            ? `下一趟 ${hm(props.w.d0 + next * HOUR)}`
            : "今日任务完成"
        prog = 0
      }
      return { id, name, icon, x, km, found, prog, progText }
    })
  )
</script>

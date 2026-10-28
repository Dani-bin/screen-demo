<!--
  右栏："检测与预警"——05 输送带检测 / 06 人机料环告警 / 07 平台预警时间线 / 08 巡检机器人与人员
-->
<template>
  <div class="col right">
    <!-- 05 输送带检测：纵撕、钢丝绳芯 X 光、跑偏（三处）、AI 异物 -->
    <Panel class="p-belt" no="05" title="输送带检测" en="TEAR · X-RAY · SWAY">
      <div class="bd-row">
        <div class="bd">
          <small>纵撕检测 · 激光 · {{ s.tear.at }} m</small>
          <b class="okc">{{ s.tear.todayTears }}<u>次撕裂</u></b>
          <em>带面损伤 {{ s.tear.scars }} 处 · {{ s.tear.lastScar }}</em>
        </div>
        <div class="bd">
          <small>钢丝绳芯 X 光</small>
          <b>{{ s.xray.joints }}<u>接头</u>{{ s.xray.broken }}<u>断丝</u></b>
          <em>最大伸长 +{{ s.xray.maxElong }} mm · {{ s.xray.lastScan }}</em>
        </div>
      </div>
      <div class="sway-head">
        <span>跑偏 · 预警 ±{{ s.swayWarn }} · 开关 ±{{ s.swayTrip }} mm</span>
        <span
          >AI 异物 大块 {{ s.foreign.bigLump }} · 锚杆
          {{ s.foreign.bolt }}</span
        >
      </div>
      <div v-for="w in s.sway" :key="w.at" class="sway">
        <small>{{ w.name }} · {{ w.at }} m</small>
        <div class="sw-bar">
          <span
            class="warn-l"
            :style="{ left: `${swayX(-s.swayWarn)}%` }"
          ></span>
          <span
            class="warn-l"
            :style="{ left: `${swayX(s.swayWarn)}%` }"
          ></span>
          <span
            class="trip-l"
            :style="{ left: `${swayX(-s.swayTrip)}%` }"
          ></span>
          <span
            class="trip-l"
            :style="{ left: `${swayX(s.swayTrip)}%` }"
          ></span>
          <i class="mid"></i>
          <b :class="swayLevel(w.mm)" :style="{ left: `${swayX(w.mm)}%` }"></b>
        </div>
        <em
          >{{ w.mm > 0 ? "+" : w.mm < 0 ? "−" : "" }}{{ Math.abs(w.mm) }} mm</em
        >
      </div>
    </Panel>

    <!-- 06 人机料环 + 实时告警 -->
    <Panel class="p-alarms" no="06" title="人机料环 · 实时告警" en="ALARMS">
      <template #extra
        ><span class="tag">{{ d.openCount }} 条未结束</span></template
      >
      <div class="dims">
        <div
          v-for="x in d.dims"
          :key="x.dim"
          class="dim"
          :class="{ has: x.open }"
        >
          <b>{{ x.dim }}</b>
          <strong>{{ x.open }}</strong>
          <small>今日 {{ x.today }}</small>
        </div>
        <ul class="levels">
          <li v-for="l in d.byLevel" :key="l.level">
            <i class="dot" :class="`l${l.level}`"></i>{{ LV[l.level]
            }}<b>{{ l.n }}</b>
          </li>
        </ul>
      </div>
      <ul class="alist">
        <li
          v-for="a in s.alarms"
          :key="a.id"
          class="al"
          :class="{ done: a.status === '已处理', pf: a.platform }"
          @click="$emit('alarm', a)"
        >
          <span v-if="a.offline" class="lv off">离线</span>
          <span v-else class="lv" :class="`l${a.level}`">{{
            LV[a.level]
          }}</span>
          <span class="dimc">{{ a.dim }}</span>
          <div class="tx">
            <b>{{ a.title }}</b>
            <small>{{ a.src }} · {{ a.place }}</small>
          </div>
          <div class="rt">
            <em v-if="a.platform" class="pf-tag">平台预警</em>
            <span class="stt">{{ a.status }}</span>
            <time>{{ a.time }}</time>
          </div>
        </li>
      </ul>
    </Panel>

    <!-- 07 平台预警：从首次听诊异响到外推的超温保护跳闸 -->
    <Panel
      class="p-platform"
      no="07"
      title="平台预警 · 预测性维护"
      en="PHM · EARLY WARNING"
    >
      <template v-if="!id35.replaced">
        <div class="pf-head">
          <div>
            <span class="pf-tag">平台预警</span>
            <b>103 第 {{ id35.group }} 组上托辊</b>
            <small
              >{{ id35.level === 4 ? "听诊异响" : "轴承劣化" }} · 差温 +{{
                fmt(Math.max(0, d.dts.diff), 1)
              }}
              ℃ · 听诊 {{ id35.score }} 分</small
            >
          </div>
          <div class="lead">
            <b>{{ fmt(d.leadDays, 1) }}</b
            ><u>天</u>
            <small>早于超温保护跳闸</small>
          </div>
        </div>
        <div class="tline">
          <div class="track"><span :style="{ width: `${nowX}%` }"></span></div>
          <div
            v-for="(st, i) in steps"
            :key="st.label"
            class="mk"
            :class="[
              st.level ? `l${st.level}` : 'plan',
              { dn: i % 2, first: i === 0 }
            ]"
            :style="{ left: `${st.x}%` }"
          >
            <i></i>
            <b>{{ st.label }}</b>
            <small>{{ st.t }}</small>
          </div>
          <div class="mk trip" style="left: 100%">
            <i></i>
            <b>超温保护跳闸（外推）</b>
            <small>{{ tripText }}</small>
          </div>
        </div>
      </template>
      <div v-else class="pf-done">
        <b>第 {{ id35.group }} 组上托辊已在检修班更换</b>
        <small
          >光纤测温、听诊恢复正常 · 本次预警比外推的超温保护跳闸提前
          {{ fmt(d.leadDays, 1) }} 天</small
        >
      </div>
    </Panel>

    <!-- 08 巡检机器人与人员 -->
    <Panel
      class="p-robot"
      no="08"
      title="巡检机器人 · 人员定位"
      en="ROBOT · UWB"
    >
      <div class="rb-head">
        <b>{{ s.robot.id }}</b
        ><span>{{ s.robot.type }}</span
        ><em>{{ s.robot.task }}</em>
      </div>
      <div class="rb-track">
        <span
          class="rb-fill"
          :style="{ width: `${(s.robot.at / L) * 100}%` }"
        ></span>
        <i class="rb-pos" :style="{ left: `${(s.robot.at / L) * 100}%` }"></i>
        <i
          v-if="s.robot.target"
          class="rb-tgt"
          :style="{ left: `${(s.robot.target / L) * 100}%` }"
        ></i>
      </div>
      <div class="rb-scale">
        <small>0 m</small>
        <!-- 目标里程标注：目标离机头很近时（如 6 m）往右让开，免得压住"0 m" -->
        <small
          v-if="s.robot.target"
          class="tgt"
          :style="{ left: `${Math.max(14, (s.robot.target / L) * 100)}%` }"
          >{{
            s.robot.target && s.robot.target === d.dts.hotAt
              ? `#${id35.group} · `
              : ""
          }}{{ s.robot.target }} m</small
        >
        <small>{{ L }} m</small>
      </div>
      <div class="rb-kv">
        <div>
          <small>电量</small><b>{{ pct(s.robot.battery) }}<u>%</u></b>
        </div>
        <div>
          <small>今日巡检</small><b>{{ s.robot.patrols }}<u>次</u></b>
        </div>
        <div>
          <small>发现隐患</small><b>{{ s.robot.found }}<u>处</u></b>
        </div>
        <div>
          <small>栈桥内人员</small><b>{{ s.people.inGallery }}<u>人</u></b>
        </div>
        <div>
          <small>围栏闯入</small><b>{{ s.people.fenceToday }}<u>次</u></b>
        </div>
      </div>
    </Panel>
  </div>
</template>

<script setup>
  import Panel from "./Panel.vue"
  import { fmt, pct, LV } from "./fmt.js"
  import { beijing } from "../sim/simulator.js"

  const props = defineProps({ d: { type: Object, required: true } })
  defineEmits(["alarm"])

  const s = computed(() => props.d.s)
  const id35 = computed(() => props.d.s.idler35)
  const L = 248

  /** 跑偏条：条带半宽对应跑偏开关的 1.2 倍 */
  const swayX = (mm) => 50 + (mm / (s.value.swayTrip * 1.2)) * 50
  const swayLevel = (mm) =>
    Math.abs(mm) >= s.value.swayTrip
      ? "l1"
      : Math.abs(mm) >= s.value.swayWarn
        ? "l3"
        : "ok"

  /** 平台预警时间线：首次异响 → 外推跳闸，按时间等比例 */
  const span = computed(() => id35.value.protectTrip - id35.value.firstWarn)
  const steps = computed(() => {
    const t0 = id35.value.firstWarn
    const year = beijing(t0).date.slice(0, 4)
    return id35.value.steps.map((st) => {
      const t = Date.parse(`${year}-${st.t.replace(" ", "T")}:00+08:00`)
      return { ...st, x: ((t - t0) / span.value) * 100 }
    })
  })
  const nowX = computed(() =>
    Math.max(
      0,
      Math.min(100, ((s.value.t - id35.value.firstWarn) / span.value) * 100)
    )
  )
  const tripText = computed(() => {
    const b = beijing(id35.value.protectTrip)
    return `${b.md} ${b.hms.slice(0, 5)}`
  })
</script>

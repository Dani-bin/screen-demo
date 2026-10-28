<!--
  左栏："这台机器"——01 档案与运行 / 02 驱动部温振 / 03 托辊健康 / 04 八大保护
  数据全部来自 store/board.js 的 deriveBoard(s)；selected 为三维里选中的设备编号（BC103-M1 …）
-->
<template>
  <div class="col left">
    <!-- 01 输送机档案与运行 -->
    <Panel
      class="p-focus"
      no="01"
      :title="`${d.F.id} ${d.F.name}`"
      en="CONVEYOR"
    >
      <template #extra>
        <span class="tag ok-tag" :class="{ stop: !d.s.running }"
          ><i></i>{{ d.s.running ? "运行" : "停机检修" }}</span
        >
      </template>
      <div class="focus">
        <div class="hl ring">
          <svg viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" class="trk" />
            <circle
              cx="36"
              cy="36"
              r="30"
              class="val"
              :stroke-dasharray="`${(C30 * d.health) / 100} ${C30}`"
              transform="rotate(-90 36 36)"
            />
          </svg>
          <div>
            <b>{{ d.health }}</b>
            <small>健康指数</small>
          </div>
        </div>
        <div class="spec">
          <p>
            <b>B{{ d.F.width }}</b> · {{ d.F.beltType }}
          </p>
          <p>
            <b>{{ d.F.len }} m</b> · 倾角 {{ d.F.angle }}° ·
            <b>2 × {{ d.F.motorRated }} kW</b>
          </p>
          <p>
            托辊 {{ d.groups }} 组 · 间距 {{ fmt(d.F.idlerPitch, 1) }} m ·
            今日运行 {{ fmt(d.F.runHoursToday, 1) }} h
          </p>
        </div>
      </div>
      <div class="kpis">
        <div v-for="k in kpis" :key="k[0]">
          <small>{{ k[0] }}</small>
          <b
            >{{ k[1] }}<u>{{ k[2] }}</u></b
          >
          <em>{{ k[3] }}</em>
        </div>
      </div>
    </Panel>

    <!-- 02 驱动部温振：振动烈度条带上画 ISO 10816 分区 -->
    <Panel class="p-drive" no="02" title="驱动部 · 温振" en="DRIVE · ISO 10816">
      <table class="tbl drive">
        <thead>
          <tr>
            <th>测点</th>
            <th>部件</th>
            <th>温度</th>
            <th>振动烈度分区</th>
            <th>mm/s</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in d.drive"
            :key="m.id"
            :class="{ warn: m.level, sel: selected === `BC103-${m.id}` }"
            @click="$emit('pick', `BC103-${m.id}`)"
          >
            <td>
              <b class="bid">{{ m.id }}</b>
            </td>
            <td class="nm">{{ m.name }}</td>
            <td class="n">{{ m.temp }}<u>℃</u></td>
            <td class="iso">
              <div class="isob">
                <span
                  v-for="z in zones"
                  :key="z.k"
                  class="zb"
                  :class="z.k"
                  :style="{ width: `${z.w}%` }"
                ></span>
                <i
                  :style="{
                    left: `${(Math.min(m.vib, ISO_MAX) / ISO_MAX) * 100}%`
                  }"
                ></i>
              </div>
            </td>
            <td class="n">{{ fmt(m.vib, 1) }}</td>
            <td>
              <span v-if="m.level" class="lv" :class="`l${m.level}`">{{
                LV[m.level]
              }}</span>
              <span v-else class="zone">{{
                d.s.running ? `${m.zone} 区` : "停机"
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="foot">
        两机功率 {{ fmt(d.drive[0].kw || 0) }} /
        {{ fmt(d.drive[1].kw || 0) }} kW · 不平衡 {{ pct(d.balance, 1) }}%
        &emsp;分区 A &lt; {{ d.s.isoZones[0] }} · B &lt; {{ d.s.isoZones[1] }} ·
        C &lt; {{ d.s.isoZones[2] }}
      </p>
    </Panel>

    <!-- 03 托辊健康：全部上托辊组按机头 → 机尾排成格子 -->
    <Panel
      class="p-idlers"
      no="03"
      :title="`托辊健康 · ${d.groups} 组`"
      en="IDLERS"
    >
      <div class="idl-grid">
        <i v-for="g in d.groups" :key="g" :class="issueClass(g)"></i>
      </div>
      <div class="idl-cnt">
        <span><i class="dot ok"></i>正常 {{ d.idlerOk }}</span>
        <span v-for="c in d.idlerCount" :key="c.level"
          ><i class="dot" :class="`l${c.level}`"></i>{{ LV[c.level] }}
          {{ c.n }}</span
        >
        <em>额定转速 {{ fmt(d.rpmNominal) }} r/min</em>
      </div>
      <table class="tbl idl">
        <thead>
          <tr>
            <th>状态</th>
            <th>组号</th>
            <th>里程</th>
            <th>温度</th>
            <th>转速</th>
            <th>听诊分</th>
            <th>判断</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in d.issues" :key="i.group">
            <td>
              <span class="lv" :class="`l${i.level}`">{{ LV[i.level] }}</span>
            </td>
            <td class="n">#{{ i.group }}</td>
            <td class="n">{{ fmt(i.at) }} m</td>
            <td class="n">{{ fmt(i.temp, 1) }}<u>℃</u></td>
            <td class="n">{{ i.rpm }}</td>
            <td class="n">{{ i.score }}</td>
            <td class="nm">{{ i.note }}</td>
          </tr>
        </tbody>
      </table>
    </Panel>

    <!-- 04 八大保护：全线 8 × 8，当前皮带行高亮 -->
    <Panel class="p-protect" no="04" title="八大保护 · 全线" en="GB 14784">
      <table class="matrix">
        <thead>
          <tr>
            <th></th>
            <th v-for="p in d.s.protections" :key="p">{{ p }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in d.belts"
            :key="b.id"
            :class="{ cur: b.id === d.F.id }"
          >
            <td class="bid">{{ b.id }}</td>
            <td v-for="p in d.s.protections" :key="p">
              <i class="pc" :class="markOf(b.id, p) ? 'platform' : 'ok'"></i>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="foot">
        <i class="pc ok"></i>正常 {{ d.protOk }} / {{ d.protTotal }}
        <template v-if="d.s.protectionMarks.length">
          &emsp;<i class="pc platform"></i>103
          超温：保护未动作，平台已提前预警</template
        >
      </p>
    </Panel>
  </div>
</template>

<script setup>
  import Panel from "./Panel.vue"
  import { fmt, pct, LV } from "./fmt.js"

  const props = defineProps({
    d: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  defineEmits(["pick"])

  const C30 = 2 * Math.PI * 30
  const ISO_MAX = 6
  /** ISO 10816 分区条：A / B / C / D 的宽度比例 */
  const zones = computed(() => {
    const z = props.d.s.isoZones
    return [
      { k: "a", w: (z[0] / ISO_MAX) * 100 },
      { k: "b", w: ((z[1] - z[0]) / ISO_MAX) * 100 },
      { k: "c", w: ((z[2] - z[1]) / ISO_MAX) * 100 },
      { k: "d", w: ((ISO_MAX - z[2]) / ISO_MAX) * 100 }
    ]
  })
  const kpis = computed(() => {
    const d = props.d
    return [
      ["运量", fmt(d.F.flow), "t/h", `负载 ${pct(d.load)}%`],
      ["带速", fmt(d.F.v, 2), "m/s", `额定 ${fmt(d.F.vRated, 2)}`],
      ["功率", fmt(d.kwTotal), "kW", `额定 ${fmt(d.kwRated)}`],
      ["吨煤电耗", fmt(d.kwh_t, 2), "kWh/t", `今日 ${fmt(d.s.flowToday)} t`]
    ]
  })
  const issueClass = (g) => {
    const i = props.d.issues.find((x) => x.group === g)
    return i ? `l${i.level}` : ""
  }
  const markOf = (belt, item) =>
    props.d.s.protectionMarks.some((m) => m.belt === belt && m.item === item)
</script>

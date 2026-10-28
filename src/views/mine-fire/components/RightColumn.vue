<!--
  右栏：按联动顺序排（定稿 v1.js 的 firePanel / judgePanel / stepPanel / peoplePanel / refugePanel）
  定稿只画了"已喷放"那一刻；正常 / 预警 / 倒计时 / 复位几个阶段用同一套令牌补出来。
-->
<template>
  <aside class="col right">
    <!-- 当前火警 -->
    <Panel :class="fireCls" title="当前火警" en="ACTIVE FIRE">
      <template #tool>{{ fireTool }}</template>
      <template v-if="f.phase === 'normal'">
        <div class="fire-top">
          <div class="fire-ico safe"><Ic name="shield" /></div>
          <div class="fire-where">
            <b>全矿无火警</b
            ><span
              >{{ st.kpi.chambers }} 个硐室 ·
              {{ st.kpi.zones }} 个防护分区自动监测中</span
            >
          </div>
          <div class="fire-dur safe"><b>0</b><span>当前火警</span></div>
        </div>
        <div class="fire-grid">
          <div><label>判定逻辑</label><b>双参量</b></div>
          <div><label>喷放延时</label><b>30 s</b></div>
          <div><label>运行方式</label><b>自动</b></div>
        </div>
      </template>
      <template v-else>
        <div class="fire-top">
          <div
            class="fire-ico"
            :class="{ warnico: f.phase === 'warn', safe: f.phase === 'reset' }"
          >
            <Ic
              :name="
                f.phase === 'reset'
                  ? 'reset'
                  : f.phase === 'warn'
                    ? 'alert'
                    : 'flame'
              "
            />
          </div>
          <div class="fire-where">
            <b>{{ ds.name }} · {{ f.zone }}</b
            ><span
              ><span class="code">{{ ds.id }}</span> · {{ ds.loc }}</span
            >
          </div>
          <div
            class="fire-dur"
            :class="{ warnd: f.phase === 'warn', safe: f.phase === 'reset' }"
          >
            <template v-if="f.phase === 'countdown'"
              ><b>{{ f.countdown }} s</b><span>距喷放</span></template
            >
            <template v-else-if="f.phase === 'warn'"
              ><b>{{ ds.read.dts.toFixed(0) }}℃</b
              ><span>光纤最高温</span></template
            >
            <template v-else
              ><b>{{ f.dur }}</b
              ><span>确认后持续</span></template
            >
          </div>
        </div>
        <div class="fire-grid">
          <div v-if="f.phase === 'warn'">
            <label>预警时间</label><b>{{ f.warnAt }}</b>
          </div>
          <div v-else>
            <label>确认时间</label><b>{{ f.confirmAt }}</b>
          </div>
          <div>
            <label>判定依据</label
            ><b>{{ f.phase === "warn" ? "单一类型" : f.combo }}</b>
          </div>
          <div>
            <label>当前状态</label
            ><b :style="{ color: statusColor }">{{ statusText }}</b>
          </div>
        </div>
      </template>
      <div class="btns">
        <span
          class="btn pick"
          :class="{ dis: f.phase === 'normal' }"
          @click="$emit('locate')"
          ><Ic name="locate" />定位火点</span
        >
        <span class="btn pick" :class="{ dis: f.phase === 'normal' }"
          ><Ic name="video" />调取视频</span
        >
        <span v-if="f.phase === 'countdown'" class="btn stopb"
          ><Ic name="stop" />紧急停止</span
        >
        <span v-else class="btn dis"><Ic name="lock" />现场手动复位</span>
      </div>
    </Panel>

    <!-- 双参量复合判定 -->
    <Panel title="双参量复合判定" en="CONFIRMATION">
      <template #tool
        >{{ j.frozen ? "判定时刻" : "实时" }} <b>{{ j.at }}</b></template
      >
      <div class="judge">
        <div
          class="jd"
          :class="j.hit.dts ? 'hit' : j.values.dts >= TH.dts.warn ? 'half' : ''"
        >
          <label
            ><span>光纤测温</span
            ><Ic :name="j.hit.dts ? 'check' : 'x'" :size="13"
          /></label>
          <b>{{ Math.round(j.values.dts) }}<small> ℃</small></b>
          <small>预警 {{ TH.dts.warn }} · 报警 {{ TH.dts.alarm }}</small>
        </div>
        <div class="jd" :class="{ hit: j.hit.smoke }">
          <label
            ><span>烟雾</span
            ><Ic :name="j.hit.smoke ? 'check' : 'x'" :size="13"
          /></label>
          <b>{{ j.hit.smoke ? "报警" : "正常" }}</b>
          <small>开关量</small>
        </div>
        <div
          class="jd"
          :class="j.hit.co ? 'hit' : j.values.co >= TH.co.warn ? 'half' : ''"
        >
          <label
            ><span>一氧化碳</span
            ><Ic :name="j.hit.co ? 'check' : 'x'" :size="13"
          /></label>
          <b>{{ Math.round(j.values.co) }}<small> ppm</small></b>
          <small>预警 {{ TH.co.warn }} · 报警 {{ TH.co.alarm }}</small>
        </div>
      </div>
      <div class="combos">
        <span
          v-for="c in j.combos"
          :key="c.k"
          class="combo"
          :class="{ hit: c.hit }"
          ><Ic :name="c.hit ? 'check' : 'x'" />组合{{ c.k }} {{ c.n }}</span
        >
      </div>
    </Panel>

    <!-- 联动处置流程 -->
    <Panel title="联动处置流程" en="LINKAGE">
      <template #tool>规格书第六章逻辑</template>
      <ol class="steps">
        <li v-for="x in st.steps" :key="x.k" :class="stepCls(x)">
          <time>{{ x.time }}</time
          ><i class="nd"></i><b>{{ x.k }}</b
          ><span>{{ x.d }}</span>
        </li>
      </ol>
    </Panel>

    <!-- 人员撤离 -->
    <Panel title="人员撤离" en="EVACUATION">
      <template #tool>人员定位联动</template>
      <div class="ppl">
        <div>
          <label><Ic name="users" :size="13" />影响区域</label
          ><b>{{ p.total }}</b
          ><i>人</i>
        </div>
        <div>
          <label><i class="dot ok"></i>已安全</label
          ><b class="ok">{{ p.safe }}</b
          ><i>人</i>
        </div>
        <div>
          <label><i class="dot route"></i>撤离中</label
          ><b class="route">{{ p.moving }}</b
          ><i>人</i>
        </div>
        <div :class="{ lost: p.lost > 0 }">
          <label><i class="dot fire"></i>未响应</label><b>{{ p.lost }}</b
          ><i>人</i>
        </div>
      </div>
      <div
        v-for="r in p.routes"
        :key="r.id"
        class="rt"
        :class="{ idle: !r.active && !r.safe }"
      >
        <div class="rt-h">
          <span class="code">{{ r.id }}</span
          ><b>{{ r.side }} → {{ r.to }}</b>
          <em
            >{{ r.active || r.safe ? r.safe : "待命"
            }}<small v-if="r.active || r.safe">/{{ r.total }}</small></em
          >
        </div>
        <div class="bar">
          <s
            v-for="[n, c, op] in [
              [r.safe, 'var(--ok)', 1],
              [r.moving, 'var(--route)', 0.55],
              [r.lost, 'var(--fire)', 1]
            ].filter((x) => x[0] > 0)"
            :key="c"
            :style="{
              width: (n / r.total) * 100 + '%',
              background: c,
              opacity: op
            }"
          ></s>
        </div>
      </div>
    </Panel>

    <!-- 永久避难硐室 -->
    <Panel class="fill" title="永久避难硐室" en="REFUGE CHAMBERS">
      <template #tool>额定 100 人</template>
      <div
        v-for="r in st.refuges"
        :key="r.id"
        class="rf pick"
        @click="$emit('refuge', r.id)"
      >
        <div class="rf-h">
          <Ic name="refuge" /><b>{{ r.name }}</b
          ><span class="code">{{ r.id }}</span>
        </div>
        <div class="rf-cap">
          <b>{{ r.inside }}</b
          ><span v-if="r.coming" style="color: var(--text-2)">
            +{{ r.coming }} 途中</span
          >
          / {{ r.cap }} 人
        </div>
        <div class="bar">
          <s
            :style="{
              width: (r.inside / r.cap) * 100 + '%',
              background: 'var(--route)'
            }"
          ></s>
          <s
            v-if="r.coming"
            :style="{
              width: (r.coming / r.cap) * 100 + '%',
              background: 'var(--route)',
              opacity: 0.4
            }"
          ></s>
        </div>
        <div class="rf-env">
          <span
            >O₂<b>{{ r.o2 }}%</b></span
          ><span
            >CO<b>{{ r.co }} ppm</b></span
          ><span
            >压风<b>{{ r.air }} MPa</b></span
          ><span
            >温度<b>{{ r.temp }}℃</b></span
          >
        </div>
      </div>
    </Panel>
  </aside>
</template>

<script setup>
  import Panel from "./Panel.vue"
  import Ic from "./Ic.vue"
  import { TH } from "../data/site.js"

  const props = defineProps({ st: Object })
  defineEmits(["locate", "refuge"])
  const f = computed(() => props.st.fire)
  const j = computed(() => props.st.judge)
  const p = computed(() => props.st.people)
  const ds = computed(() => props.st.chambers.find((c) => c.id === f.value.ds))

  // 面板外观：火警阶段用红色标题条，预警用黄色，复位用绿色
  const fireCls = computed(
    () =>
      ({
        countdown: "alarm",
        sprayed: "alarm",
        warn: "warnp",
        reset: "okp",
        normal: ""
      })[f.value.phase]
  )
  const fireTool = computed(
    () =>
      ({
        normal: "无",
        warn: "已派巡检核查",
        countdown: "联动执行中",
        sprayed: "联动已执行",
        reset: "已复位"
      })[f.value.phase]
  )
  const statusText = computed(
    () =>
      ({
        warn: "待核查",
        countdown: `延时 ${f.value.countdown} s`,
        sprayed: "已喷放·锁定",
        reset: "已复位"
      })[f.value.phase]
  )
  const statusColor = computed(
    () =>
      ({
        warn: "var(--warn)",
        countdown: "#ff8a80",
        sprayed: "#ff8a80",
        reset: "var(--ok)"
      })[f.value.phase]
  )

  /** 联动步骤的样式：前两步是预警（黄），火灾确认（红），进行中（绿圈），未到（灰） */
  function stepCls(x) {
    if (x.status === "pending") return "pending"
    if (x.status === "active")
      return x.k === "延时喷放" ? "active cd" : "active"
    if (x.hot) return "hot"
    if (x.pre) return "pre"
    return "done"
  }
</script>

<!--
  场景上的固定叠加层：火警横幅、数据来源行（+ 演练回放控制，定稿之外新增）、视角按钮、图例与图层开关、指北针
-->
<template>
  <div class="overlay">
    <!-- 横幅：预警黄、火警红、复位绿；正常时不显示 -->
    <div v-if="st.phase !== 'normal'" class="banner" :class="st.phase">
      <Ic :name="st.phase === 'reset' ? 'check' : 'alert'" />
      <span class="bn-k">{{ bannerKey }}</span>
      <b>{{ ds.name }} {{ st.fire.zone }}</b
      ><i></i>
      <template v-if="st.phase === 'warn'">
        <span
          >光纤 <span class="num">{{ ds.read.dts.toFixed(1) }}</span> ℃ ·
          单一类型</span
        ><i></i><span>不断电 · 不喷放 · 已派巡检</span>
      </template>
      <template v-else-if="st.phase === 'countdown'">
        <span
          >{{ st.fire.combo }}确认
          <span class="num">{{ st.fire.confirmAt }}</span></span
        ><i></i> <span>已断电 · 已关防火阀</span><i></i
        ><span
          >喷放倒计时 <span class="num">{{ st.fire.countdown }}</span> s</span
        >
      </template>
      <template v-else-if="st.phase === 'sprayed'">
        <span
          >{{ st.fire.combo }}确认
          <span class="num">{{ st.fire.confirmAt }}</span></span
        ><i></i> <span>已断电 · 已关防火阀 · 已喷放</span><i></i>
        <span v-if="st.people.moving + st.people.lost > 0"
          >撤离中 <span class="num">{{ st.people.moving }}</span> 人</span
        >
        <span v-else>人员已全部安全</span>
      </template>
      <template v-else>
        <span
          >现场复位 <span class="num">{{ st.hms.slice(0, 5) }}</span></span
        ><i></i><span>待充装 {{ st.units.sprayed }} 台</span>
      </template>
    </div>

    <div class="upd">
      <span>布局依据 <b>2#煤层避灾路线图 1:5000</b></span>
      <span
        >人员定位 <b>{{ st.hms }}</b></span
      >
      <span
        >监测数据 <b>{{ st.hms }}</b> 演练回放</span
      >
      <!-- 演练回放控制（定稿之外新增） -->
      <span class="play pick">
        <a :title="playing ? '暂停' : '播放'" @click="$emit('toggle')"
          ><Ic :name="playing ? 'pause' : 'play'"
        /></a>
        <a title="重放" @click="$emit('restart')"><Ic name="reset" /></a>
        <b>×{{ speed }}</b>
      </span>
    </div>

    <div class="views">
      <a
        v-for="v in VIEWS"
        :key="v.key"
        class="pick"
        :class="{ on: view === v.key }"
        @click="$emit('view', v.key)"
        ><Ic v-if="v.key === 'home'" name="eye" />{{ v.name }}</a
      >
    </div>

    <div class="sbar">
      <div class="legend">
        <span><i class="dot ok"></i>硐室正常</span>
        <span><i class="dot fire"></i>火警</span>
        <span><i class="dot fault"></i>故障</span>
        <span
          ><i class="lg-ln" style="background: var(--route)"></i>避灾路线</span
        >
        <span><i class="dot route"></i>避难硐室</span>
        <span><i class="dot" style="color: #fff"></i>人员</span>
      </div>
      <div class="tools">
        <a
          v-for="l in LAYERS"
          :key="l.key"
          class="pick"
          :class="{ on: layers[l.key] }"
          @click="$emit('layer', l.key)"
          ><Ic :name="l.icon" />{{ l.name }}</a
        >
      </div>
    </div>

    <svg class="compass" viewBox="0 0 44 44">
      <circle cx="22" cy="24" r="15" stroke="rgba(148,190,230,.35)" />
      <path d="M22 11l4 13h-8z" fill="var(--brand)" stroke="none" />
      <path d="M22 37l-4-13h8z" fill="rgba(148,190,230,.35)" stroke="none" />
      <text x="22" y="8">N</text>
    </svg>
  </div>
</template>

<script setup>
  import Ic from "./Ic.vue"

  const props = defineProps({
    st: Object,
    view: String,
    layers: Object,
    playing: Boolean,
    speed: Number
  })
  defineEmits(["view", "layer", "toggle", "restart"])
  const ds = computed(() =>
    props.st.chambers.find((c) => c.id === props.st.fire.ds)
  )
  const bannerKey = computed(
    () =>
      ({ warn: "预警", countdown: "火警", sprayed: "火警", reset: "复位" })[
        props.st.phase
      ]
  )

  const VIEWS = [
    { key: "home", name: "全矿" },
    { key: "hub", name: "井底车场" },
    { key: "ds04", name: "一盘区变电所" },
    { key: "refuge", name: "避难硐室" }
  ]
  const LAYERS = [
    { key: "tubes", name: "巷道", icon: "layers" },
    { key: "airflow", name: "风流", icon: "wind" },
    { key: "people", name: "人员", icon: "users" },
    { key: "sensors", name: "传感器", icon: "radar" },
    { key: "routes", name: "避灾路线", icon: "route" }
  ]
</script>

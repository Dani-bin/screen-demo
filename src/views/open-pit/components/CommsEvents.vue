<!--
  07 通信与事件：12 座 5G 基站的在线 / 上行速率，近 4 小时最新 4 条事件（设计稿 #c-comms 的移植）
  点基站格 = 选中基站；点事件行 = 选中事件的对象（卡车 / 设备 / 传感器编号，三维里飞过去）
-->
<template>
  <section class="card c-comms">
    <h3 style="margin-bottom: 6px">
      <i>07</i>通信与事件<em
        >5G 基站 {{ c.online }}/{{ c.total }} · 上行 Mbps · 均
        {{ c.avgUpMbps }}</em
      >
    </h3>
    <div
      style="
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 3px;
        margin-bottom: 5px;
      "
    >
      <div
        v-for="b in c.bs"
        :key="b.id"
        class="pick"
        :class="{ sel: selection === b.id }"
        :style="{
          border: `1px solid ${b.online ? 'var(--line)' : 'var(--offline)'}`,
          height: '34px',
          padding: '1px 0',
          textAlign: 'center',
          background: b.online ? '' : 'rgba(100,116,139,.2)'
        }"
        @click="select(b.id)"
        @mousemove="onTip($event, b)"
        @mouseleave="hideTip"
      >
        <div
          class="num"
          :style="{
            fontSize: '13px',
            lineHeight: '15px',
            color: b.online ? 'var(--ink)' : 'var(--ink-3)'
          }"
        >
          {{ b.id.replace("BS-", "") }}
        </div>
        <div
          class="num"
          :style="{
            fontSize: '12px',
            lineHeight: '14px',
            color: b.online ? 'var(--ink-2)' : 'var(--offline)'
          }"
        >
          {{ b.online ? b.upMbps : "离线" }}
        </div>
        <div
          :style="{
            height: '2px',
            marginTop: '1px',
            background: b.online ? 'var(--ok)' : 'var(--offline)'
          }"
        ></div>
      </div>
    </div>
    <div
      v-for="e in events"
      :key="e.id"
      class="ev pick"
      @click="selectIfKnown(e.target)"
    >
      <span class="tm">{{ e.from }}</span
      ><b class="dot" :style="{ background: LV_DOT[e.level] }"></b
      ><span class="ti">{{ e.title }}</span>
    </div>
  </section>
</template>

<script setup>
  const { fast, selection, select, selectIfKnown, showTip, hideTip } =
    inject("board")
  const c = computed(() => fast.value.comms)
  // 最新 4 条事件（快数据里已按时间从近到远排好）
  const events = computed(() => fast.value.events.slice(0, 4))
  const LV_DOT = {
    major: "var(--fault)",
    minor: "var(--warn)",
    info: "var(--neon-cyan)"
  }
  function onTip(e, b) {
    showTip(
      e,
      `${b.id} · ${b.online ? "在线" : "离线"}`,
      b.online
        ? [
            { k: "上行", v: `${b.upMbps} Mbps` },
            { k: "接入终端", v: `${b.terminals} 台` }
          ]
        : [{ k: "覆盖的 GNSS 站", v: "数据过期" }]
    )
  }
</script>

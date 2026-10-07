<!-- 告警信息：四级未处理计数 + 最近告警列表 -->
<template>
  <section class="panel alarm">
    <div class="ptitle" style="color: var(--red)">
      <BellRing />
      <h3>告警信息</h3>
      <span class="more">···</span>
    </div>
    <div class="count">
      <div
        v-for="(lv, i) in LEVELS"
        :key="lv.name"
        :style="{ '--c': lv.color }"
      >
        <span>{{ lv.name }}告警</span>
        <b class="num">{{ count[i] }}</b>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th>级别</th>
          <th>告警内容</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in alarms.slice(0, 4)" :key="a.time + a.content">
          <td class="num">{{ a.time }}</td>
          <td>
            <span class="lv" :style="{ color: levelColor(a.level) }">{{
              a.level
            }}</span>
          </td>
          <td class="content" :class="{ hot: a.state !== '已处理' }">
            {{ a.content }}
          </td>
          <td :style="{ color: stateColor(a.state) }">{{ a.state }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
  import { BellRing } from "lucide-vue-next"

  defineProps({
    alarms: { type: Array, required: true },
    /** [紧急, 重要, 一般, 提示] 未处理数 */
    count: { type: Array, required: true }
  })

  const LEVELS = [
    { name: "紧急", color: "#ff3b47" },
    { name: "重要", color: "#ff9f43" },
    { name: "一般", color: "#f5c242" },
    { name: "提示", color: "#8aa0bd" }
  ]
  const levelColor = (lv) =>
    LEVELS.find((l) => l.name === lv)?.color || "#8aa0bd"
  const stateColor = (s) =>
    s === "未处理" ? "#ff3b47" : s === "处理中" ? "#ff9f43" : "#34e07a"
</script>

<style lang="scss" scoped>
  .alarm {
    height: 294px;
  }

  .count {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 8px;

    div {
      padding: 6px 0;
      text-align: center;
      border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
      border-radius: 4px;
      background: color-mix(in srgb, var(--c) 8%, transparent);
    }

    span {
      display: block;
      font-size: 12px;
      color: var(--c);
    }

    b {
      font-size: 22px;
      font-weight: normal;
      color: var(--c);
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  th {
    padding: 4px;
    text-align: left;
    font-weight: normal;
    color: var(--muted);
  }

  td {
    padding: 5.5px 4px;
    border-top: 1px solid rgba(74, 144, 226, 0.1);
    white-space: nowrap;
  }

  .content {
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;

    &.hot {
      color: #ffc9a8;
    }
  }

  .lv {
    padding: 0 5px;
    border: 1px solid;
    border-radius: 2px;
    font-size: 11px;
  }
</style>

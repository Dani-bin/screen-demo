<!--
  左栏：去哪里（起点 / 终点 + 交换）、搜索、楼层切换、本层科室列表
  列表每项附"从起点步行约几分钟"（按路网实际算出）。点"起点"行进入选起点状态，再点列表里的地点即设为起点；
  默认选的是终点。
-->
<template>
  <aside class="place-panel">
    <section class="card where">
      <h2>去哪里</h2>
      <button
        class="row"
        :class="{ picking: pick === 'start' }"
        @click="emit('pick', 'start')"
      >
        <NavIcon name="start" class="ic start" />
        <span class="val">{{ start.name }}</span>
        <span class="sub">起点 · {{ floorLabel(start.floor) }}</span>
      </button>
      <span class="link"></span>
      <button
        class="row"
        :class="{ picking: pick === 'end' }"
        @click="emit('pick', 'end')"
      >
        <NavIcon name="end" class="ic end" />
        <span class="val">{{ end.name }}</span>
        <span class="sub"
          >终点 · {{ end.num ? end.num + " · " : ""
          }}{{ floorLabel(end.floor) }}</span
        >
      </button>
      <button class="swap" title="交换起点和终点" @click="emit('swap')">
        <NavIcon name="swap" />
      </button>
    </section>

    <label class="card search">
      <NavIcon name="search" class="ic" />
      <input
        :value="query"
        type="text"
        :placeholder="
          pick === 'start'
            ? '选择起点：搜索科室或房间号'
            : '搜索科室、检查项目或房间号'
        "
        @input="emit('search', $event.target.value)"
      />
    </label>

    <nav class="tabs">
      <button
        v-for="(t, f) in tabs"
        :key="f"
        :class="{ on: f === floor && !query }"
        @click="emit('floor', f)"
      >
        {{ t }}
      </button>
    </nav>

    <section class="card list">
      <p v-if="pick === 'start'" class="hint">正在选择起点，点一个地点即可</p>
      <button
        v-for="it in items"
        :key="it.id"
        class="item"
        :class="{ on: it.id === activeId }"
        @click="emit('select', it.id)"
      >
        <span class="num">{{ it.num || floorLabel(it.floor, true) }}</span>
        <span class="name">{{ it.name }}</span>
        <span class="min">{{
          it.minutes != null ? `约 ${it.minutes} 分钟` : ""
        }}</span>
      </button>
      <p v-if="!items.length" class="hint">没有找到"{{ query }}"</p>
    </section>
  </aside>
</template>

<script setup>
  import NavIcon from "./NavIcon.vue"
  import { FLOORS, FLOOR_TITLES } from "../route"

  defineProps({
    start: { type: Object, required: true },
    end: { type: Object, required: true },
    pick: { type: String, default: "end" },
    floor: { type: Number, default: 2 },
    query: { type: String, default: "" },
    items: { type: Array, required: true },
    activeId: { type: String, default: "" }
  })
  const emit = defineEmits(["pick", "swap", "search", "floor", "select"])

  const tabs = FLOORS.map((f, i) => `${f} ${FLOOR_TITLES[i].replace("层", "")}`)
  const floorLabel = (f, short = false) =>
    short ? FLOORS[f] : `${FLOORS[f]} ${FLOOR_TITLES[f]}`
</script>

<style lang="scss" scoped>
  .place-panel {
    position: absolute;
    left: 40px;
    top: 92px;
    width: 360px;
    bottom: 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card {
    background: var(--panel);
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .where {
    position: relative;
    padding: 22px 24px 18px;
    h2 {
      font-family: "Alimama ShuHeiTi";
      font-size: 20px;
      margin-bottom: 14px;
    }
    .row {
      display: grid;
      grid-template-columns: 24px 1fr;
      column-gap: 16px;
      align-items: center;
      width: calc(100% - 56px);
      padding: 6px 8px;
      margin-left: -8px;
      border-radius: 4px;
      transition: background 0.2s;
      &.picking {
        background: var(--panel2);
      }
      .ic {
        grid-row: span 2;
        font-size: 24px;
        &.start {
          color: var(--start);
        }
        &.end {
          color: var(--end);
          --icon-hole: var(--panel);
        }
      }
      .val {
        font-family: "Alimama ShuHeiTi";
        font-size: 22px;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub {
        font-size: 14px;
        color: var(--sub);
      }
    }
    .link {
      display: block;
      width: 3px;
      height: 14px;
      margin: 0 0 0 10px;
      background: var(--faint);
    }
    .swap {
      position: absolute;
      right: 24px;
      top: 84px;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      background: var(--panel2);
      color: var(--sub);
      font-size: 24px;
      &:hover {
        color: var(--ink);
      }
    }
  }
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    padding: 0 18px;
    .ic {
      font-size: 22px;
      color: var(--faint);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: 16px;
      color: var(--ink);
      &::placeholder {
        color: var(--faint);
      }
    }
  }
  .tabs {
    display: flex;
    button {
      flex: 1;
      height: 48px;
      background: var(--panel);
      color: var(--sub);
      font-size: 16px;
      text-align: center;
      transition:
        background 0.2s,
        color 0.2s;
      &.on {
        background: var(--sign);
        color: var(--sign-ink);
      }
    }
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 0;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
    .item {
      position: relative;
      display: grid;
      grid-template-columns: 52px 1fr auto;
      align-items: center;
      width: 100%;
      height: 44px;
      padding: 0 20px 0 24px;
      transition: background 0.2s;
      &:hover {
        background: var(--panel2);
      }
      &.on {
        background: var(--route-tint);
        &::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--route);
        }
        .num {
          color: var(--route);
        }
      }
    }
    .num {
      font-family: "DIN";
      font-size: 17px;
      color: var(--sub);
    }
    .name {
      font-size: 17px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .min {
      font-size: 14px;
      color: var(--sub);
    }
    .hint {
      padding: 6px 24px 10px;
      font-size: 14px;
      color: var(--faint);
    }
  }
</style>

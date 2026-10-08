<!--
  楼层导航：全部楼层（58F → B3）排成 8 列色块，色深 = 入驻率；选中层金色、告警层红色。
  点击色块与三维抽屉联动，悬浮时三维里对应楼层高亮；下方一行显示选中楼层的信息。
-->
<template>
  <section>
    <PanelTitle title="楼层导航">
      <template #extra>共 {{ floors.length }} 层</template>
    </PanelTitle>
    <div class="body">
      <div class="grid">
        <span
          v-for="f in ordered"
          :key="f.key"
          class="fl num"
          :class="{
            sel: f.key === selected,
            hov: f.key === hovered,
            alarm: f.alarm,
            plant: f.kind === 'plant',
            base: f.index < 0
          }"
          :style="{ background: fill(f) }"
          :title="`${f.key} · ${f.name}`"
          @click="$emit('select', f.key === selected ? null : f.key)"
          @mouseenter="$emit('hover', f.key)"
          @mouseleave="$emit('hover', null)"
          >{{ f.key }}</span
        >
      </div>
      <div class="legend">
        <span><i class="ramp"></i>色深 = 入驻率</span>
        <span><i class="gold"></i>已选</span>
        <span><i class="red"></i>告警楼层</span>
        <span><i class="green"></i>设备层</span>
      </div>
      <div v-if="current" class="info">
        <b class="num">{{ current.key }}</b>
        <span class="name">{{ current.name }}</span>
        <span v-if="current.occupancy != null"
          >入驻率 <em class="num">{{ current.occupancy }}%</em></span
        >
        <span
          >在岗 <em class="num">{{ current.staff }}</em> 人</span
        >
        <span v-if="current.alarm" class="warn">{{ current.alarm }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    /** data/building.js 的 towerFloors(key)，自下而上 */
    floors: { type: Array, required: true },
    selected: { type: String, default: null },
    hovered: { type: String, default: null }
  })
  defineEmits(["select", "hover"])

  // 从高到低排：58F 在左上，B3 在右下
  const ordered = computed(() => props.floors.slice().reverse())
  const current = computed(
    () => props.floors.find((f) => f.key === props.selected) || null
  )

  /** 色块底色：入驻率越高越亮的蓝；无入驻率的层（设备层、地下）用深灰蓝 */
  function fill(f) {
    if (f.occupancy == null) return "rgba(40, 60, 90, 0.45)"
    const t = Math.max(0, Math.min(1, (f.occupancy - 55) / 45))
    return `rgba(${20 + 30 * t}, ${70 + 90 * t}, ${150 + 90 * t}, ${0.25 + 0.5 * t})`
  }
</script>

<style lang="scss" scoped>
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }

  .fl {
    height: 25px;
    border: 1px solid rgba(74, 170, 255, 0.35);
    font-size: 12px;
    line-height: 23px;
    text-align: center;
    color: #dceaff;
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &.plant {
      border-color: rgba(61, 220, 151, 0.7);
      color: #7ff0c0;
    }

    &.base {
      color: #a9b8cc;
    }

    &.alarm {
      border-color: #ff4d5a;
      color: #ff8a92;
      background: rgba(255, 77, 90, 0.25) !important;
    }

    &.hov {
      border-color: #59d6ff;
      box-shadow: 0 0 8px rgba(89, 214, 255, 0.6);
    }

    &.sel {
      border-color: #ffc65a;
      color: #ffe6b0;
      background: rgba(150, 100, 20, 0.6) !important;
      box-shadow: 0 0 10px rgba(255, 190, 70, 0.6);
    }
  }

  .legend {
    display: flex;
    gap: 14px;
    margin-top: 8px;
    font-size: 12px;
    color: #8aa0bd;

    i {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 4px;
      vertical-align: -1px;

      &.ramp {
        width: 22px;
        background: linear-gradient(90deg, #14467a, #3aa0f0);
      }

      &.gold {
        background: #ffc65a;
      }

      &.red {
        background: #ff4d5a;
      }

      &.green {
        background: #3ddc97;
      }
    }
  }

  .info {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 10px;
    padding: 6px 10px;
    border-left: 2px solid #ffc65a;
    background: rgba(120, 80, 10, 0.22);
    font-size: 12px;
    color: #8aa0bd;

    b {
      font-size: 18px;
      font-weight: normal;
      color: #ffd27a;
    }

    .name {
      font-size: 14px;
      color: #fff;
    }

    em {
      font-style: normal;
      font-size: 14px;
      color: #2de2e6;
    }

    .warn {
      color: #ff8a92;
    }
  }
</style>

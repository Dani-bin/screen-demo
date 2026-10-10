<!--
  房间列表：编号、名称、类型、状态（办公区在岗/工位数、会议室使用中 / 空闲、机房告警）。
  与三维联动：悬浮行高亮三维房间，点击选中（金色）；三维里悬浮 / 选中的房间在列表里同步高亮
-->
<template>
  <section>
    <PanelTitle title="房间列表">
      <template #extra>共 {{ rooms.length }} 间</template>
    </PanelTitle>
    <div class="body">
      <ul class="list">
        <li
          v-for="r in shown"
          :key="r.id"
          :class="{ sel: r.id === selected, hov: r.id === hovered }"
          @click="$emit('select', r.id === selected ? null : r.id)"
          @mouseenter="$emit('hover', r.id)"
          @mouseleave="$emit('hover', null)"
        >
          <span class="id num">{{ r.id }}</span>
          <span class="nm">{{ r.name }}</span>
          <span class="tp">{{ r.typeName }}</span>
          <span class="st" :class="r.level">{{ r.status }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    rooms: { type: Array, required: true },
    selected: { type: String, default: null },
    hovered: { type: String, default: null }
  })
  defineEmits(["select", "hover"])

  // 列表只列有业务意义的房间（核心筒里的楼梯、卫生间、保洁间不列），按编号排
  const SKIP = new Set(["stair", "wc", "service", "lobby"])
  const shown = computed(() =>
    props.rooms
      .filter((r) => !SKIP.has(r.type))
      .sort((a, b) => a.id.localeCompare(b.id))
  )
</script>

<style lang="scss" scoped>
  .list {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 30px;
      padding: 0 8px;
      border-left: 2px solid transparent;
      font-size: 13px;
      cursor: pointer;

      &:nth-child(odd) {
        background: rgba(20, 70, 140, 0.12);
      }

      &.hov {
        background: rgba(47, 155, 255, 0.16);
      }

      &.sel {
        border-left-color: #ffc65a;
        background: linear-gradient(
          90deg,
          rgba(150, 100, 20, 0.45),
          rgba(150, 100, 20, 0.08)
        );

        .nm {
          color: #ffe6b0;
        }
      }
    }

    .id {
      width: 40px;
      color: #8fb4dc;
    }

    .nm {
      flex: 1;
      color: #e2ecf8;
    }

    .tp {
      width: 48px;
      font-size: 12px;
      color: #7f93ad;
    }

    .st {
      min-width: 64px;
      padding: 1px 0;
      text-align: center;
      font-size: 12px;
      background: rgba(138, 160, 189, 0.15);
      color: #a9b9cf;

      &.ok {
        background: rgba(61, 220, 151, 0.15);
        color: #3ddc97;
      }

      &.busy {
        background: rgba(255, 198, 90, 0.18);
        color: #ffc65a;
      }

      &.alarm {
        background: rgba(255, 77, 90, 0.2);
        color: #ff4d5a;
      }
    }
  }
</style>

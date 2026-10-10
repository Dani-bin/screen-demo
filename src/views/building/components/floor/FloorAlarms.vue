<!-- 楼层告警：等级标签 + 内容 + 位置 + 时间；点击定位到房间（三维选中） -->
<template>
  <section>
    <PanelTitle title="楼层告警">
      <template #extra>{{ alarms.length }} 起</template>
    </PanelTitle>
    <div class="body">
      <ul class="list">
        <li
          v-for="(a, i) in alarms"
          :key="i"
          :class="LEVEL[a.level].cls"
          @click="$emit('locate', a.room)"
        >
          <span class="lv">{{ LEVEL[a.level].name }}</span>
          <div class="tx">
            <p class="t">{{ a.title }}</p>
            <p class="p">{{ a.place }}</p>
          </div>
          <span class="tm num">{{ a.time }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    alarms: { type: Array, required: true }
  })
  defineEmits(["locate"])

  const LEVEL = {
    1: { name: "紧急", cls: "l1" },
    2: { name: "重要", cls: "l2" },
    3: { name: "一般", cls: "l3" }
  }
</script>

<style lang="scss" scoped>
  $l1: #ff4d5a;
  $l2: #ff9f43;
  $l3: #2f9bff;

  .list {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 4px;
      border-bottom: 1px dashed rgba(74, 144, 226, 0.2);
      cursor: pointer;

      &:hover {
        background: rgba(47, 155, 255, 0.08);
      }
    }

    .lv {
      flex-shrink: 0;
      padding: 1px 6px;
      font-size: 12px;
    }

    .l1 .lv {
      background: rgba($l1, 0.2);
      color: $l1;
    }

    .l2 .lv {
      background: rgba($l2, 0.2);
      color: $l2;
    }

    .l3 .lv {
      background: rgba($l3, 0.2);
      color: $l3;
    }

    .tx {
      flex: 1;
      min-width: 0;

      p {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .t {
        font-size: 13px;
        color: #e2ecf8;
      }

      .p {
        font-size: 11px;
        color: #7f93ad;
      }
    }

    .tm {
      font-size: 14px;
      color: #8aa0bd;
    }
  }
</style>

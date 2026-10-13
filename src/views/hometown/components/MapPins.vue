<!-- 全景标注："我家"红色名牌 + 小拍立得（点击进入近景）、回家路线编号圆点（用户不要地名标注）。
     位置来自场景每帧投影的锚点（设计稿坐标） -->
<template>
  <div class="pins">
    <div
      v-for="(n, i) in nodes"
      :key="'n' + i"
      class="node"
      :style="{ left: rem(n[0]), top: rem(n[1]) }"
    >
      {{ i + 1 }}
    </div>
    <template v-if="anchors.home">
      <div
        class="pin home"
        :style="{ left: rem(anchors.home[0]), top: rem(anchors.home[1] - 44) }"
        @click="$emit('home')"
      >
        <em>我家</em>
      </div>
      <div
        class="mini"
        :style="{
          left: rem(anchors.home[0] + 86),
          top: rem(anchors.home[1] - 196)
        }"
        @click="$emit('home')"
      >
        <img :src="photo" alt="老家老照片" />
        <b>点我回家看看</b>
      </div>
    </template>
  </div>
</template>

<script setup>
  import { rem } from "../utils"

  const props = defineProps({
    anchors: { type: Object, required: true },
    photo: { type: String, required: true }
  })
  defineEmits(["home"])

  const nodes = computed(() => props.anchors.nodes.filter(Boolean))
</script>

<style lang="scss" scoped>
  .pins {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  .pin {
    position: absolute;
    transform: translate(-50%, -100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    em {
      font-style: normal;
      padding: 5px 13px;
      font-size: 16px;
      letter-spacing: 2px;
      background: var(--pin-bg);
      color: var(--pin-ink);
      border-radius: 3px;
      box-shadow: 0 3px 10px rgba(30, 16, 4, 0.25);
      white-space: nowrap;
      transition:
        background 0.6s,
        color 0.6s;
    }
    &::after {
      content: "";
      width: 1px;
      height: 30px;
      background: linear-gradient(
        rgba(255, 247, 232, 0.9),
        rgba(255, 247, 232, 0)
      );
    }
  }
  .pin.home {
    pointer-events: auto;
    cursor: pointer;
    em {
      font-family: "Alimama ShuHeiTi";
      font-size: 26px;
      padding: 8px 20px;
      color: #fff;
      background: var(--seal);
      border-radius: 4px;
      box-shadow: 0 8px 22px rgba(120, 30, 20, 0.45);
    }
    &::after {
      width: 2px;
      height: 52px;
      background: linear-gradient(#f2c37a, rgba(242, 195, 122, 0));
    }
  }
  .mini {
    position: absolute;
    width: 128px;
    padding: 7px 7px 22px;
    background: var(--paper);
    box-shadow: 0 10px 26px rgba(20, 10, 0, 0.4);
    transform: rotate(6deg);
    font-size: 13px;
    color: var(--ink-2);
    text-align: center;
    pointer-events: auto;
    cursor: pointer;
    transition: transform 0.3s;
    &:hover {
      transform: rotate(2deg) scale(1.06);
    }
    img {
      display: block;
      width: 100%;
      height: 96px;
      object-fit: cover;
      object-position: center 35%;
      filter: sepia(0.15);
    }
    b {
      position: absolute;
      bottom: 4px;
      left: 0;
      right: 0;
      font-weight: normal;
      letter-spacing: 1px;
    }
  }
  .node {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--cream);
    color: var(--ink);
    font-family: "DIN";
    font-size: 16px;
    display: grid;
    place-items: center;
    border: 2px solid var(--warm);
    box-shadow:
      0 0 0 5px rgba(233, 168, 75, 0.28),
      0 4px 10px rgba(0, 0, 0, 0.3);
  }
</style>

<!-- 我家近景：返回全景、贴胶带的老照片卡片、底部信息行（用户不要在模型上贴文字注记） -->
<template>
  <div class="detail">
    <button class="back" @click="$emit('back')">← 返回全景</button>
    <div class="card">
      <div class="tape l"></div>
      <div class="tape r"></div>
      <img :src="photo" alt="老家老照片" />
      <h3>
        {{ HOME_CARD.title
        }}<small v-if="HOME_CARD.built">{{ HOME_CARD.built }}</small>
      </h3>
      <p>
        <template v-for="(l, i) in HOME_CARD.lines" :key="i"
          >{{ l }}<br
        /></template>
      </p>
      <div class="date">{{ HOME_CARD.date }}</div>
    </div>
    <div class="foot">
      <span>正房三层</span><span>地坝 12 × 9 米</span
      ><span>两旁六棵枇杷树</span>
    </div>
  </div>
</template>

<script setup>
  import { HOME_CARD } from "../data/memories"

  defineProps({
    photo: { type: String, required: true }
  })
  defineEmits(["back"])
</script>

<style lang="scss" scoped>
  .detail {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    > * {
      pointer-events: auto;
    }
  }
  .back {
    position: absolute;
    left: 76px;
    top: 214px;
    padding: 10px 20px;
    border-radius: 4px;
    background: var(--paper);
    font-size: 17px;
    letter-spacing: 2px;
    color: var(--ink);
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(30, 16, 4, 0.3);
  }
  .card {
    position: absolute;
    right: 104px;
    top: 168px;
    width: 500px;
    padding: 20px 20px 26px;
    background: var(--paper);
    color: var(--ink);
    border-radius: 3px;
    transform: rotate(2.4deg);
    box-shadow: 0 30px 60px rgba(20, 10, 0, 0.45);
    animation: drop 0.8s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    img {
      display: block;
      width: 100%;
      height: 540px;
      object-fit: cover;
      object-position: center 40%;
      filter: sepia(0.2) saturate(0.92) contrast(0.96);
    }
    h3 {
      margin-top: 18px;
      font-family: "Alimama ShuHeiTi";
      font-size: 32px;
      letter-spacing: 4px;
      small {
        font-family: "Source Han Sans CN";
        font-size: 17px;
        letter-spacing: 1px;
        color: var(--ink-2);
        margin-left: 12px;
      }
    }
    p {
      margin-top: 10px;
      font-size: 17px;
      line-height: 1.8;
      color: var(--ink-2);
    }
    .date {
      position: absolute;
      right: 22px;
      bottom: 24px;
      font-family: "DIN";
      font-size: 18px;
      color: #c06a2a;
      opacity: 0.85;
      transform: rotate(-3deg);
    }
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-40px) rotate(8deg);
    }
  }
  .tape {
    position: absolute;
    top: -16px;
    width: 120px;
    height: 32px;
    background: rgba(240, 214, 160, 0.78);
    &.l {
      left: 30px;
      transform: rotate(-8deg);
    }
    &.r {
      right: 30px;
      transform: rotate(7deg);
    }
  }
  .foot {
    position: absolute;
    left: 76px;
    bottom: 52px;
    color: var(--cream);
    font-size: 18px;
    letter-spacing: 3px;
    pointer-events: none;
    span + span::before {
      content: "·";
      margin: 0 12px;
      opacity: 0.6;
    }
  }
</style>

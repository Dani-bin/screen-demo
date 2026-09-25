<!--
 * @Author:
 * @Date: 2025-09-04 17:44:22
 * @Description: 大屏弹窗容器，支持全屏与居中两种模式
-->
<template>
  <div v-if="visible" class="pop-up-notification" :class="{ 'is-centered': centered }">
    <div class="popup-container" :style="centered ? containerStyle : undefined">
      <div class="title">{{ title }}</div>
      <div class="close" @click="close">
        <img src="@/assets/images/close.svg" alt="关闭" />
      </div>
      <div class="content">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
const emit = defineEmits(["close"])

const props = defineProps({
  title: {
    type: String,
    default: ""
  },
  visible: {
    type: Boolean,
    default: false
  },
  /** 是否居中弹窗（非全屏） */
  centered: {
    type: Boolean,
    default: false
  },
  /** 居中模式下的弹窗宽度 */
  width: {
    type: String,
    default: "1180px"
  },
  /** 居中模式下的弹窗高度 */
  height: {
    type: String,
    default: "680px"
  }
})

const containerStyle = computed(() => ({
  width: props.width,
  height: props.height,
  maxWidth: "92vw",
  maxHeight: "85vh"
}))

const close = () => {
  emit("close")
}

defineExpose({
  close
})
</script>

<style lang="scss" scoped>
.pop-up-notification {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(17, 34, 54, 0.5);
  z-index: 100;

  .popup-container {
    width: 100%;
    height: 100%;
    background: url("@/assets/images/dialog-bg.svg") no-repeat center center;
    background-size: cover;
    position: absolute;
    top: 0;
    left: 0;

    .title {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 74px;
      font-weight: bold;
      color: #fff;
    }

    .close {
      width: 138px;
      height: 138px;
      background: radial-gradient(100% 49% at 80% 60%,
          rgba(0, 7, 14, 0) 0%,
          rgba(5, 184, 249, 0.6) 100%);
      box-shadow: 0px 0px 10px 0px rgba(0, 195, 255, 0.25);
      border-radius: 50%;
      position: absolute;
      top: 50px;
      right: 80px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99;

      &:hover {
        background: radial-gradient(100% 49% at 80% 60%,
            rgba(0, 7, 14, 0) 0%,
            rgba(5, 184, 249, 0.9) 100%);
        box-shadow: 0px 0px 10px 0px rgba(0, 195, 255, 0.5);

        img {
          transform: scale(1.1);
        }
      }

      img {
        width: 90px;
      }
    }

    .content {
      width: 100%;
      height: 100%;
      padding: 150px 60px 60px 100px;
      box-sizing: border-box;
    }
  }

  /* 居中弹窗模式：保留遮罩全屏，弹窗本体限定宽高 */
  &.is-centered {
    display: flex;
    align-items: center;
    justify-content: center;

    .popup-container {
      position: relative;
      top: auto;
      left: auto;
      border-radius: 8px;
      border: 1px solid rgba(0, 206, 234, 0.35);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
      overflow: hidden;
      background: linear-gradient(180deg,
          rgba(10, 52, 108, 0.98) 0%,
          rgba(10, 52, 108, 0.98) 72px,
          rgba(16, 28, 48, 0.96) 72px);

      .title {
        top: 18px;
        left: 24px;
        transform: none;
        font-size: 28px;
        font-weight: 600;
        line-height: 1;
      }

      .close {
        width: 50px;
        height: 50px;
        top: 14px;
        right: 16px;
        box-shadow: none;
        background: transparent;

        &:hover {
          background: rgba(0, 206, 234, 0.15);
          box-shadow: none;
        }

        img {
          width: 32px;
        }
      }

      .content {
        padding: 72px 20px 20px;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
    }
  }
}
</style>

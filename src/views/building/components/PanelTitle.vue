<!--
  面板标题（400 宽）：左侧发光标题块 + 右侧渐隐横线，样式沿用射阳应急大屏的面板标题。
  extra 插槽放在标题行最右侧（单位、更多等）。
-->
<template>
  <div class="panel-title">
    <div class="title-bg">
      <div class="title-left">
        <img class="title-frame" src="../assets/panel-title-frame.svg" alt="" />
        <img
          class="title-left-fill"
          src="../assets/panel-title-left.svg"
          alt=""
        />
        <img
          class="title-left-border"
          src="../assets/panel-title-left-border.svg"
          alt=""
        />
        <div class="title-deco">
          <img src="../assets/title-deco.png" alt="" />
        </div>
      </div>
      <div class="title-right">
        <div class="title-line-body"></div>
        <div class="title-line-glow"></div>
        <img
          class="title-top-line"
          src="../assets/panel-title-top-line.svg"
          alt=""
        />
      </div>
    </div>
    <div class="title-content">
      <span class="title-icon"></span>
      <span class="title-text">{{ title }}</span>
    </div>
    <div class="title-extra"><slot name="extra" /></div>
  </div>
</template>

<script setup>
  defineProps({
    title: { type: String, default: "" }
  })
</script>

<style lang="scss" scoped>
  $line-mask: url("../assets/panel-title-line-mask.svg");
  $deco-mask: url("../assets/panel-title-deco-mask.svg");

  .panel-title {
    position: relative;
    width: 400px;
    height: 30px;
    flex-shrink: 0;
  }

  .title-bg {
    position: absolute;
    left: 0;
    top: 0;
    width: 400px;
    height: 36px;
    pointer-events: none;
  }

  .title-left {
    position: absolute;
    left: 0;
    top: 0;
    width: 134px;
    height: 36px;

    .title-frame {
      position: absolute;
      left: -40px;
      top: -35px;
      width: 190px;
      height: 78px;
      max-width: none;
    }

    .title-left-fill {
      position: absolute;
      left: 0;
      top: 2px;
      width: 126px;
      height: 17px;
    }

    .title-left-border {
      position: absolute;
      left: 0;
      top: 1.79px;
      width: 126.45px;
      height: 17.71px;
    }

    /* 标题块里的流光纹理，用遮罩裁成标题块的斜角外形 */
    .title-deco {
      position: absolute;
      left: 1px;
      top: 2px;
      width: 126px;
      height: 17px;
      overflow: hidden;
      mask-image: $deco-mask;
      mask-size: 100% 100%;
      mask-repeat: no-repeat;

      img {
        position: absolute;
        left: 50%;
        bottom: -1px;
        transform: translateX(calc(-50% + 5px));
        width: 109px;
        height: 15px;
        object-fit: contain;
        object-position: bottom;
        opacity: 0.8;
      }
    }
  }

  .title-right {
    position: absolute;
    left: 142px;
    top: 1px;
    width: 258px;
    height: 20px;
  }

  .title-line-body {
    position: absolute;
    left: 0;
    top: 1px;
    width: 258px;
    height: 14px;
    background: linear-gradient(
      90deg,
      rgba(32, 60, 105, 0) 2.73%,
      rgba(0, 58, 153, 0.5) 49.48%,
      rgba(32, 60, 105, 0) 96.22%
    );
    mask-image: $line-mask;
    mask-size: 100% 100%;
    mask-repeat: no-repeat;
  }

  .title-line-glow {
    position: absolute;
    left: 0;
    top: 0;
    width: 258px;
    height: 4px;
    background: #004ec8;
    filter: blur(10px);
    mask-image: $line-mask;
    mask-size: 100% 100%;
    mask-repeat: no-repeat;
  }

  .title-top-line {
    position: absolute;
    left: 0;
    top: 1px;
    width: 258px;
    height: 1px;
  }

  .title-content {
    position: absolute;
    left: 7px;
    top: -3px;
    display: flex;
    align-items: center;
    gap: 8px;

    /* 两个错位的小方块组成的图标 */
    .title-icon {
      position: relative;
      width: 10px;
      height: 10px;
      flex-shrink: 0;

      &::before,
      &::after {
        content: "";
        position: absolute;
        border-radius: 0.6px;
      }

      &::before {
        inset: 0 20% 20% 0;
        background: linear-gradient(
          180deg,
          rgba(232, 243, 255, 0.6) 0%,
          rgba(180, 216, 255, 0) 100%
        );
      }

      &::after {
        inset: 20% 0 0 20%;
        background: linear-gradient(
          180deg,
          #cfe6ff 0%,
          rgba(242, 248, 255, 0.2) 100%
        );
      }
    }

    .title-text {
      font-family: "Source Han Sans CN", sans-serif;
      font-weight: 500;
      font-size: 18px;
      background: linear-gradient(
        180deg,
        #f2f8ff 23.81%,
        #f2f8ff 59.82%,
        #cfe6ff 76.19%
      );
      background-clip: text;
      color: transparent;
      white-space: nowrap;
    }
  }

  .title-extra {
    position: absolute;
    right: 0;
    top: -4px;
    font-size: 12px;
    color: #8aa0bd;
  }
</style>

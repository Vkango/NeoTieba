<template>
  <Teleport to="body">
  <Transition name="drawer" mode="out-in">
    <div id="drawer-mask" v-if="isDrawerOpen.state">
    </div>
  </Transition>
  <Transition name="drawer1" mode="out-in">
    <div id="drawer-container" v-if="isDrawerOpen.state" @click="closeDrawer">
      <div id="config-drawer" @click.stop :style="{ width: props.width }">
        <div id="detail" @click.stop
          :style="{ top: top_position ? '0px' : '50px', height: top_position ? '100%' : 'calc(100% - 50px)' }">
          <slot></slot>
        </div>
        <div id="control">
          <RippleButton style="padding: 0; box-shadow: none; background-color: transparent; border-radius: 0;">
            <span class="material-symbols-outlined" id="back" style="font-size: 19px;" @click="closeDrawer">
              arrow_back
            </span>
          </RippleButton>
          <span id="drawer-title">{{ ctitle }}</span>
        </div>
      </div>

    </div>
  </Transition>
  </Teleport>
</template>
<script setup lang="ts">
import RippleButton from '#components/common/RippleButton.vue';
import { getCurrentInstance } from 'vue';
let isDrawerOpen = getCurrentInstance()?.appContext.config.globalProperties.$IsDrawerOpen;
const closeDrawer = () => {
  isDrawerOpen.state = false;
};
const props = defineProps({
  ctitle: {
    type: String,
    required: true
  },
  top_position: {
    type: Boolean,
    required: false,
    default: false
  },
  width: {
    type: String,
    required: false,
    default: '400px',
  }
});
</script>
<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer1-enter-active,
.drawer1-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;

}

.drawer1-enter-from,
.drawer1-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

#control {
  display: flex;
  align-items: center;
  gap: 10px;
}

#config-drawer {
  position: absolute;
  right: 0px;
  top: 0px;
  height: 100%;
  width: min(400px, calc(100vw - 70px));
  background-color: rgba(var(--background-color), 1);
  box-shadow: 0px 10px 60px 10px rgba(0, 0, 0, 0.2);

}

#detail {
  position: absolute;
  overflow-y: auto;
  width: 100%;
}

#back {

  padding: 15px;
}

#drawer-title {
  width: calc(100% - 47px);
  color: rgba(var(--text-color));
  font-size: 13px;
}

#drawer-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: flex-end;
  z-index: 3101;
}

#drawer-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.2);
  display: flex;
  justify-content: flex-end;
  z-index: 3100;
}
</style>
<script setup lang="ts">
// SYSTEMA — application root
</script>

<template>
  <!--
    `app-safe-top` applies the status-bar / camera cutout inset to the
    WHOLE app, not just the mobile header.

    It lives here rather than in MobileHeader because several pages
    (Library, Search, Settings, AI) set `hideMobileHeader` and render
    their own top bars — with the inset on the header only, those four
    screens still slid under the camera. Applying it at the root means
    every page clears the cutout regardless of which chrome it uses.
  -->
  <div class="app-safe-top">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
  <UToaster position="top-center" class="app-safe-top !bg-transparent" :ui="{ width: 'w-80' }" />
</template>

<style>
/*
  env(safe-area-inset-top) is enabled by viewport-fit=cover, already set
  in nuxt.config.ts. It resolves to 0 in the browser and on devices
  without a cutout, so this is inert outside notched phones.

  Padding rather than margin: margin on the root would collapse with
  child margins and would not be covered by the background.
*/
.app-safe-top {
  padding-top: var(--sys-safe-top, env(safe-area-inset-top, 0px));
}
div.app-safe-top {
  background: var(--sys-background);
}
</style>

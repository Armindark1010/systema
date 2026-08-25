<script setup lang="ts">
// ============================================================
// SETTINGS — system configuration parent
// Nested routes: hub + dedicated category pages
// ============================================================

useHead({ title: 'Settings' })
definePageMeta({ hideMobileHeader: true })
</script>

<template>
  <SettingsLayout>
    <NuxtPage />
  </SettingsLayout>
</template>

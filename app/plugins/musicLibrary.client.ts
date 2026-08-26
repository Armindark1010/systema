// ============================================================
// SYSTEMA — Native music library boot
// ============================================================
// Initialises the device library once, on the client, after the app
// mounts. On the web `initNativeLibrary()` detects that no native
// plugin exists and returns immediately, leaving the mock catalog
// exactly as it is — `npm run dev` never touches a native API.
// ============================================================

import { useLibraryStore } from '~/stores/library'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    const library = useLibraryStore()
    // Fire and forget: library boot must never block first paint, and
    // any failure is captured as store state rather than thrown.
    void library.initNativeLibrary().catch(() => {
      /* handled inside the store as libraryError */
    })
  })
})

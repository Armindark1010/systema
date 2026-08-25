// ============================================================
// useQuickSearch — global command palette state
// ============================================================

const open = ref(false)
const query = ref('')

export function useQuickSearch() {
  function openPalette() {
    query.value = ''
    open.value = true
  }
  function closePalette() {
    open.value = false
  }
  return { open, query, openPalette, closePalette }
}

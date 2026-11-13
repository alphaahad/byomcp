/** Where the Light/Dark choice is remembered (this browser only). */
export const THEME_KEY = "byomcp:theme";

/**
 * Runs inline in <head> before first paint, so a saved choice never flashes
 * the other theme. "Auto" = no attribute = follow the device.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// OpenComputerUseVirtualDisplayShim — the only place that touches the private
// CGVirtualDisplay classes (CoreGraphics). Every class is resolved with
// NSClassFromString at runtime, so nothing here is a hard link dependency; a
// macOS without the classes reports "unsupported" and the caller fails closed.
#ifndef CODEX_PLUS_AGENT_DISPLAY_SHIM_H
#define CODEX_PLUS_AGENT_DISPLAY_SHIM_H

#include <stdint.h>
#include <ApplicationServices/ApplicationServices.h>

#ifdef __cplusplus
extern "C" {
#endif

/// 1 when the private CGVirtualDisplay classes exist on this system.
int cp_virtual_display_is_supported(void);

/// Create a virtual display of `width` x `height` points at `refresh_rate` Hz.
/// Returns the CGDirectDisplayID (0 on failure) and stores an opaque retained
/// handle in `handle_out`; pass it to `cp_virtual_display_destroy` to remove
/// the display again.
uint32_t cp_virtual_display_create(const char *name, uint32_t width, uint32_t height, double refresh_rate, void **handle_out);

/// An explicit identity permits independent app-agent namespaces to coexist.
uint32_t cp_virtual_display_create_with_serial(const char *name, uint32_t width, uint32_t height, double refresh_rate, uint32_t serial_number, void **handle_out);

/// Direct AX identity mapping; returns 0 if unavailable. No geometry fallback.
uint32_t cp_window_id(AXUIElementRef element);

/// Remove the display and release the handle.
void cp_virtual_display_destroy(void *handle);

#ifdef __cplusplus
}
#endif

#endif

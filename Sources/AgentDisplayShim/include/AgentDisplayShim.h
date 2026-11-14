#ifndef CODEX_PLUS_AGENT_DISPLAY_SHIM_H
#define CODEX_PLUS_AGENT_DISPLAY_SHIM_H
#include <stdint.h>
#include <ApplicationServices/ApplicationServices.h>
/// Direct AX identity mapping; returns 0 if unavailable. No geometry fallback.
uint32_t cp_window_id(AXUIElementRef element);
#endif

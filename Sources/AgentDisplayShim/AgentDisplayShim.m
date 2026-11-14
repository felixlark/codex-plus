// Exact AX to CG window identity. No display creation or reconfiguration.
#import "AgentDisplayShim.h"
#import <dlfcn.h>

uint32_t cp_window_id(AXUIElementRef element) {
    typedef AXError (*GetWindow)(AXUIElementRef, CGWindowID *);
    static GetWindow getWindow;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        void *services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY);
        getWindow = services ? (GetWindow)dlsym(services, "_AXUIElementGetWindow") : NULL;
    });
    CGWindowID window = 0;
    return getWindow && getWindow(element, &window) == kAXErrorSuccess ? window : 0;
}

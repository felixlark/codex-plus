// Adapted from Open Computer Use fccf49a, Copyright (c) 2026 Leo, MIT.
// See third_party/OpenComputerUse-LICENSE. Product/serial distinguish Plus ownership.
#import "AgentDisplayShim.h"

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <dlfcn.h>

// Method surfaces of the private classes, declared as protocols so messaging
// is typed for ARC without creating link-time class references.
@protocol OCUVirtualDisplayMode <NSObject>
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(double)refreshRate;
@end

@protocol OCUVirtualDisplay <NSObject>
- (instancetype)initWithDescriptor:(id)descriptor;
- (BOOL)applySettings:(id)settings;
@end

int cp_virtual_display_is_supported(void) {
    return NSClassFromString(@"CGVirtualDisplayDescriptor") != nil
        && NSClassFromString(@"CGVirtualDisplay") != nil
        && NSClassFromString(@"CGVirtualDisplaySettings") != nil
        && NSClassFromString(@"CGVirtualDisplayMode") != nil;
}

uint32_t cp_virtual_display_create(const char *name, uint32_t width, uint32_t height, double refresh_rate, void **handle_out) {
    return cp_virtual_display_create_with_serial(name, width, height, refresh_rate, 1, handle_out);
}

uint32_t cp_virtual_display_create_with_serial(const char *name, uint32_t width, uint32_t height, double refresh_rate, uint32_t serial_number, void **handle_out) {
    if (handle_out == NULL || !cp_virtual_display_is_supported()) {
        return 0;
    }
    *handle_out = NULL;

    @try {
        @autoreleasepool {
            Class descriptorClass = NSClassFromString(@"CGVirtualDisplayDescriptor");
            Class displayClass = NSClassFromString(@"CGVirtualDisplay");
            Class settingsClass = NSClassFromString(@"CGVirtualDisplaySettings");
            Class modeClass = NSClassFromString(@"CGVirtualDisplayMode");

            // Scalars go through KVC so the runtime boxes them with the property's
            // real type encoding instead of a guessed C type.
            NSObject *descriptor = [[descriptorClass alloc] init];
            [descriptor setValue:[NSString stringWithUTF8String:name ?: "Open Computer Use"] forKey:@"name"];
            [descriptor setValue:@(width) forKey:@"maxPixelsWide"];
            [descriptor setValue:@(height) forKey:@"maxPixelsHigh"];
            [descriptor setValue:[NSValue valueWithSize:NSMakeSize(width * 0.26, height * 0.26)] forKey:@"sizeInMillimeters"];
            [descriptor setValue:@(0xC0D1) forKey:@"productID"];
            [descriptor setValue:@(0x0CAC) forKey:@"vendorID"];
            [descriptor setValue:@(serial_number) forKey:@"serialNum"];
            [descriptor setValue:dispatch_get_main_queue() forKey:@"queue"];

            id<OCUVirtualDisplay> display = [[displayClass alloc] initWithDescriptor:descriptor];
            if (display == nil) {
                return 0;
            }

            id<OCUVirtualDisplayMode> mode = [[modeClass alloc] initWithWidth:width height:height refreshRate:refresh_rate];
            NSObject *settings = [[settingsClass alloc] init];
            [settings setValue:@(1) forKey:@"hiDPI"];
            [settings setValue:@[mode] forKey:@"modes"];
            if (![display applySettings:settings]) {
                return 0;
            }

            uint32_t displayID = [[(NSObject *)display valueForKey:@"displayID"] unsignedIntValue];
            if (displayID == 0) {
                return 0;
            }
            *handle_out = (void *)CFBridgingRetain(display);
            return displayID;
        }
    } @catch (NSException *exception) {
        // Private KVC keys and selector signatures can change between macOS
        // releases. Treat that as an unavailable capability, not a crash.
        (void)exception;
        return 0;
    }
}

void cp_virtual_display_destroy(void *handle) {
    if (handle == NULL) {
        return;
    }
    @try {
        @autoreleasepool {
            id display = CFBridgingRelease(handle);
            display = nil;
        }
    } @catch (NSException *exception) {
        // Destruction is best-effort; there is no safe recovery operation for
        // an opaque private object after its teardown throws.
        (void)exception;
    }
}

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

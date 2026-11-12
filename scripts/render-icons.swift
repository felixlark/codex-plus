import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let manager = FileManager.default
try manager.createDirectory(at: output, withIntermediateDirectories: true)
let ink = NSColor(srgbRed: 18/255, green: 59/255, blue: 53/255, alpha: 1)
let mint = NSColor(srgbRed: 190/255, green: 244/255, blue: 220/255, alpha: 1)

// All surfaces share a 20-unit circular symbol with rounded, equal-weight strokes.
func symbol(_ context: CGContext, color: NSColor) {
    context.setStrokeColor(color.cgColor)
    context.setFillColor(color.cgColor)
    context.setLineWidth(1.4)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.strokeEllipse(in: CGRect(x: 2.75, y: 2.75, width: 14.5, height: 14.5))
    context.move(to: CGPoint(x: 10, y: 6.75))
    context.addLine(to: CGPoint(x: 10, y: 13.25))
    context.move(to: CGPoint(x: 6.75, y: 10))
    context.addLine(to: CGPoint(x: 13.25, y: 10))
    context.strokePath()
}

func appIcon(_ context: CGContext) {
    context.setFillColor(ink.cgColor)
    context.fillEllipse(in: CGRect(x: 1.25, y: 1.25, width: 17.5, height: 17.5))
    context.saveGState()
    context.translateBy(x: 2.2, y: 2.2)
    context.scaleBy(x: 0.78, y: 0.78)
    symbol(context, color: mint)
    context.restoreGState()
}

func bitmap(pixels: Int, draw: (CGContext) -> Void) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: pixels * 4, bitsPerPixel: 32)!
    rep.size = NSSize(width: pixels, height: pixels)
    let graphics = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.scaleBy(x: CGFloat(pixels)/20, y: CGFloat(pixels)/20)
    draw(graphics.cgContext)
    NSGraphicsContext.restoreGraphicsState()
    return rep
}
func save(_ rep: NSBitmapImageRep, _ path: String) throws {
    try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(path))
}

let set = output.appendingPathComponent("AppIcon.iconset", isDirectory: true)
try manager.createDirectory(at: set, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        try save(bitmap(pixels: size * scale, draw: appIcon), "AppIcon.iconset/icon_\(size)x\(size)\(suffix).png")
    }
}
try save(bitmap(pixels: 1024, draw: appIcon), "AppIcon.png")

var mediaBox = CGRect(x: 0, y: 0, width: 18, height: 18)
let consumer = CGDataConsumer(url: output.appendingPathComponent("MenuBarIcon.pdf") as CFURL)!
let pdf = CGContext(consumer: consumer, mediaBox: &mediaBox, nil)!
pdf.beginPDFPage(nil)
pdf.scaleBy(x: 18/20, y: 18/20)
symbol(pdf, color: .black)
pdf.endPDFPage()
pdf.closePDF()

print(output.path)

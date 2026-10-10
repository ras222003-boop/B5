import AppKit
import Foundation

// Temporary high-resolution icon for a private research TestFlight build.
// The official Basira artwork can replace it before any public release.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let destination = root.appendingPathComponent("ios/DepthCalibrationLab/DepthCalibrationLab/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)

guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                                    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false,
                                    isPlanar: false, colorSpaceName: .deviceRGB,
                                    bytesPerRow: 0, bitsPerPixel: 0),
      let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Cannot allocate icon bitmap")
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
let bounds = NSRect(x: 0, y: 0, width: 1024, height: 1024)
NSColor(srgbRed: 0.08, green: 0.11, blue: 0.16, alpha: 1).setFill()
bounds.fill()
NSColor(srgbRed: 0.93, green: 0.69, blue: 0.23, alpha: 1).setStroke()
let ring = NSBezierPath(ovalIn: NSRect(x: 150, y: 150, width: 724, height: 724))
ring.lineWidth = 30
ring.stroke()
let letter = NSAttributedString(string: "B", attributes: [
    .font: NSFont.systemFont(ofSize: 580, weight: .bold),
    .foregroundColor: NSColor(srgbRed: 0.99, green: 0.86, blue: 0.52, alpha: 1)
])
let size = letter.size()
letter.draw(at: NSPoint(x: (1024 - size.width) / 2, y: (1024 - size.height) / 2 - 17))
graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode generated app icon")
}
try png.write(to: destination, options: .atomic)
print("Generated research-only icon at \(destination.path)")

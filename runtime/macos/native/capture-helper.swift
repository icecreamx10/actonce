import AppKit
import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

@available(macOS 14.0, *)
@main
struct ActOnceCaptureHelper {
  private static var captures: [UInt32: WindowCapture] = [:]

  static func main() async {
    _ = NSApplication.shared
    NSApplication.shared.setActivationPolicy(.prohibited)
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        guard let data = line.data(using: .utf8) else { continue }
        do {
          guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let id = request["id"],
                let method = request["method"] as? String else {
            throw HelperError.invalidRequest
          }
          let params = request["params"] as? [String: Any] ?? [:]
          let result: Any
          switch method {
          case "targets":
            result = try await targets()
          case "capture":
            guard let windowId = uint32(params["windowId"]) else { throw HelperError.missingWindowId }
            result = try await capture(windowId: windowId)
          default:
            throw HelperError.unknownMethod(method)
          }
          write(["id": id, "result": result])
        } catch {
          let failedRequest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
          write(["id": failedRequest?["id"] ?? NSNull(), "error": [
            "code": helperErrorCode(error),
            "message": String(describing: error),
          ]])
        }
      }
    } catch {
      fputs("capture helper input failed: \(error)\n", stderr)
    }
    for capture in captures.values {
      await capture.close()
    }
    captures.removeAll()
  }

  private static func targets() async throws -> [[String: Any]] {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    return content.windows.compactMap { window in
      guard window.windowID != 0,
            window.windowLayer == 0,
            window.frame.width > 1,
            window.frame.height > 1,
            let title = window.title,
            !title.isEmpty else { return nil }
      let app = window.owningApplication
      return [
        "targetId": "macos-window-\(window.windowID)",
        "windowId": window.windowID,
        "pid": app?.processID ?? 0,
        "bundleId": app?.bundleIdentifier ?? "",
        "processName": app?.applicationName ?? "",
        "title": title,
        "bounds": [
          "x": window.frame.origin.x,
          "y": window.frame.origin.y,
          "width": window.frame.width,
          "height": window.frame.height,
        ],
      ]
    }
  }

  private static func capture(windowId: UInt32) async throws -> [String: Any] {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
      throw HelperError.windowNotFound(windowId)
    }
    let stream: WindowCapture
    if let existing = captures[windowId], existing.matches(window) {
      stream = existing
    } else {
      if let existing = captures.removeValue(forKey: windowId) {
        await existing.close()
      }
      stream = try WindowCapture(window: window)
      captures[windowId] = stream
    }
    let image = try await stream.nextFrame()
    let png = try pngData(image)
    let actualScale = window.frame.width > 0 ? Double(image.width) / window.frame.width : 1
    return [
      "pngBase64": png.base64EncodedString(),
      "widthPx": image.width,
      "heightPx": image.height,
      "scaleFactor": actualScale,
    ]
  }

  private static func pngData(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
      data,
      UTType.png.identifier as CFString,
      1,
      nil
    ) else { throw HelperError.pngEncodingFailed }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw HelperError.pngEncodingFailed }
    return data as Data
  }

  private static func uint32(_ value: Any?) -> UInt32? {
    if let number = value as? NSNumber { return number.uint32Value }
    if let string = value as? String { return UInt32(string) }
    return nil
  }

  private static func write(_ value: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
  }

  private static func helperErrorCode(_ error: Error) -> String {
    if case HelperError.frameTimeout = error { return "CAPTURE_UNAVAILABLE" }
    let native = error as NSError
    if native.domain == SCStreamErrorDomain { return "CAPTURE_UNAVAILABLE" }
    return "NATIVE_HELPER_ERROR"
  }
}

@available(macOS 14.0, *)
private final class WindowCapture: NSObject {
  private let frame: CGRect
  private let output = FrameOutput()
  private let stream: SCStream
  private var started = false

  init(window: SCWindow) throws {
    frame = window.frame
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = max(1.0, Double(filter.pointPixelScale))
    configuration.width = max(1, Int(window.frame.width * scale))
    configuration.height = max(1, Int(window.frame.height * scale))
    configuration.showsCursor = false
    configuration.capturesAudio = false
    configuration.queueDepth = 3
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
    super.init()
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
  }

  func matches(_ window: SCWindow) -> Bool {
    frame.width == window.frame.width && frame.height == window.frame.height
  }

  func nextFrame() async throws -> CGImage {
    let baseline = output.sequence
    if !started {
      try await stream.startCapture()
      started = true
    }
    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline {
      if let image = output.image(after: baseline) { return image }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    throw HelperError.frameTimeout
  }

  func close() async {
    guard started else { return }
    try? await stream.stopCapture()
    started = false
  }
}

@available(macOS 14.0, *)
private final class FrameOutput: NSObject, SCStreamOutput {
  let queue = DispatchQueue(label: "com.byted-lynx.actonce.capture.frames", qos: .userInteractive)
  private let lock = NSLock()
  private let context = CIContext(options: [.cacheIntermediates: false])
  private var latest: CGImage?
  private var generation = 0

  var sequence: Int {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  func image(after sequence: Int) -> CGImage? {
    lock.lock()
    defer { lock.unlock() }
    return generation > sequence ? latest : nil
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen,
          sampleBuffer.isValid,
          let pixelBuffer = sampleBuffer.imageBuffer else { return }
    let source = CIImage(cvPixelBuffer: pixelBuffer)
    guard let image = context.createCGImage(source, from: source.extent) else { return }
    lock.lock()
    latest = image
    generation += 1
    lock.unlock()
  }
}

enum HelperError: Error, CustomStringConvertible {
  case invalidRequest
  case missingWindowId
  case unknownMethod(String)
  case windowNotFound(UInt32)
  case pngEncodingFailed
  case frameTimeout

  var description: String {
    switch self {
    case .invalidRequest: return "invalid request"
    case .missingWindowId: return "capture requires windowId"
    case .unknownMethod(let method): return "unknown method: \(method)"
    case .windowNotFound(let id): return "window not found: \(id)"
    case .pngEncodingFailed: return "PNG encoding failed"
    case .frameTimeout: return "timed out waiting for the next ScreenCaptureKit frame"
    }
  }
}

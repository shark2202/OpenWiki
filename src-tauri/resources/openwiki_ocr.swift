import Vision
import Foundation
import CoreGraphics
import ImageIO
import PDFKit
import AppKit

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: ocr <image_path>\n", stderr)
    exit(1)
}
let imagePath = args[1]
let imageURL = URL(fileURLWithPath: imagePath)

/// OCR a single CGImage tile and return recognized lines
func ocrTile(_ tile: CGImage) -> [String] {
    let semaphore = DispatchSemaphore(value: 0)
    var lines: [String] = []

    let request = VNRecognizeTextRequest { request, error in
        if let observations = request.results as? [VNRecognizedTextObservation] {
            lines = observations.compactMap { $0.topCandidates(1).first?.string }
        }
        semaphore.signal()
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: tile, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fputs("Vision error: \(error.localizedDescription)\n", stderr)
        semaphore.signal()
    }
    semaphore.wait()
    return lines
}

func ocrImage(_ cgImage: CGImage) -> [String] {
    let width = cgImage.width
    let height = cgImage.height
    let maxTileHeight = 2000  // Split images taller than 2000px into tiles

    if height <= maxTileHeight {
        return ocrTile(cgImage)
    }

    var allLines: [String] = []
    let overlap = 100  // Avoid cutting text at tile boundaries
    var y = 0
    while y < height {
        let tileH = min(maxTileHeight, height - y)
        let rect = CGRect(x: 0, y: y, width: width, height: tileH)
        if let tile = cgImage.cropping(to: rect) {
            let tileLines = ocrTile(tile)
            // Deduplicate: skip lines that match the last line from previous tile (overlap region)
            if !allLines.isEmpty && !tileLines.isEmpty {
                // Find where overlap starts — skip duplicate lines
                var startIdx = 0
                for i in 0..<min(5, tileLines.count) {
                    if allLines.last == tileLines[i] {
                        startIdx = i + 1
                        break
                    }
                }
                allLines.append(contentsOf: tileLines[startIdx...])
            } else {
                allLines.append(contentsOf: tileLines)
            }
        }
        y += tileH - overlap
        if tileH < maxTileHeight { break }
    }
    return allLines
}

func renderPdfPage(_ page: PDFPage, scale: CGFloat) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let size = CGSize(
        width: max(1, bounds.width * scale),
        height: max(1, bounds.height * scale)
    )
    let thumbnail = page.thumbnail(of: size, for: .mediaBox)
    var rect = CGRect(origin: .zero, size: thumbnail.size)
    return thumbnail.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

var allLines: [String] = []
let ext = imageURL.pathExtension.lowercased()

if ext == "pdf" {
    guard let document = PDFDocument(url: imageURL), document.pageCount > 0 else {
        fputs("Cannot load PDF: \(imagePath)\n", stderr)
        exit(1)
    }

    for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex),
              let pageImage = renderPdfPage(page, scale: 2.0) else {
            continue
        }
        let pageLines = ocrImage(pageImage)
        if !pageLines.isEmpty {
            if !allLines.isEmpty {
                allLines.append("")
            }
            allLines.append(contentsOf: pageLines)
        }
    }
} else {
    guard let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
        fputs("Cannot load image: \(imagePath)\n", stderr)
        exit(1)
    }
    allLines = ocrImage(cgImage)
}

let resultText = allLines.joined(separator: "\n")
print(resultText)

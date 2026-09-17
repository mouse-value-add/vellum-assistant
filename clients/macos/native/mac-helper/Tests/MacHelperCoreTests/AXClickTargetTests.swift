import CoreGraphics
import Testing

@testable import MacHelperCore

@Suite("AXClickTarget")
struct AXClickTargetTests {
    private static let archiveFrame = CGRect(x: 400, y: 200, width: 80, height: 24)

    private static let archive = AXClickTarget.Element(
        role: "AXButton", label: "Archive", frame: archiveFrame, actionable: true
    )

    private static func element(
        _ role: String,
        _ label: String?,
        _ frame: CGRect = archiveFrame,
        actionable: Bool = true
    ) -> AXClickTarget.Element {
        AXClickTarget.Element(role: role, label: label, frame: frame, actionable: actionable)
    }

    @Test("the observed element under the point reaches the target")
    func sameElement() {
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: [Self.archive]) == .reachesTarget)
    }

    /// A button's icon or a link's text is what the hit test returns, and the
    /// control the model named is its parent.
    @Test("a child of the target reaches the target through its ancestors")
    func childOfTarget() {
        let icon = Self.element("AXImage", nil, CGRect(x: 430, y: 204, width: 16, height: 16), actionable: false)
        let chain = [icon, Self.archive, Self.element("AXGroup", nil, .init(x: 0, y: 0, width: 900, height: 600), actionable: false)]
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: chain) == .reachesTarget)
    }

    @Test("a layout that shifted a few points still reaches the target")
    func smallShift() {
        let shifted = Self.element("AXButton", "Archive", Self.archiveFrame.offsetBy(dx: 3, dy: 4))
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: [shifted]) == .reachesTarget)
    }

    /// A mail list that moved one row puts the next message's Archive button
    /// exactly where this one was.
    @Test("an identically named control from a moved row is a different element")
    func namesakeFromMovedRow() {
        let nextRow = Self.element("AXButton", "Archive", Self.archiveFrame.offsetBy(dx: 0, dy: 24))
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: [nextRow]) == .differentElement(nextRow))
    }

    @Test("a control with another name under the point is a different element")
    func differentLabel() {
        let delete = Self.element("AXButton", "Delete")
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: [delete]) == .differentElement(delete))
    }

    /// A toggle that turned from Play into Pause would do the opposite of what
    /// the model chose.
    @Test("a relabelled control is a different element")
    func relabelled() {
        let play = Self.element("AXButton", "Play")
        let pause = Self.element("AXButton", "Pause")
        #expect(AXClickTarget.verdict(target: play, hitChain: [pause]) == .differentElement(pause))
    }

    @Test("a sheet over the point reports its nearest control")
    func covered() {
        let sheetText = Self.element("AXStaticText", "Save changes?", actionable: false)
        let dontSave = Self.element("AXButton", "Don't Save")
        let sheet = Self.element("AXSheet", nil, .init(x: 300, y: 100, width: 400, height: 300), actionable: false)
        #expect(
            AXClickTarget.verdict(target: Self.archive, hitChain: [sheetText, dontSave, sheet])
                == .differentElement(dontSave)
        )
    }

    /// Web views can answer a hit test with a wrapper and nothing inside it.
    @Test("a chain with nothing actionable is unknown")
    func coarseHit() {
        let chain = [
            Self.element("AXGroup", nil, .init(x: 0, y: 80, width: 1200, height: 800), actionable: false),
            Self.element("AXWebArea", "Inbox", .init(x: 0, y: 80, width: 1200, height: 800), actionable: false),
        ]
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: chain) == .unknown)
    }

    @Test("no answer from the hit test is unknown")
    func noAnswer() {
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: nil) == .unknown)
        #expect(AXClickTarget.verdict(target: Self.archive, hitChain: []) == .unknown)
    }

    @Test("a target observed without a frame is matched by identity")
    func noFrame() {
        let target = Self.element("AXButton", "Archive", .zero)
        #expect(AXClickTarget.verdict(target: target, hitChain: [Self.archive]) == .reachesTarget)
    }

    @Test("overlap is intersection over union")
    func overlapMeasure() {
        let square = CGRect(x: 0, y: 0, width: 10, height: 10)
        #expect(AXClickTarget.overlap(square, square) == 1)
        #expect(AXClickTarget.overlap(square, square.offsetBy(dx: 20, dy: 0)) == 0)
        #expect(AXClickTarget.overlap(square, square.offsetBy(dx: 10, dy: 0)) == 0)
        // Half-shifted squares share 50 of a 150 union.
        #expect(abs(AXClickTarget.overlap(square, square.offsetBy(dx: 5, dy: 0)) - 1.0 / 3.0) < 0.0001)
    }
}

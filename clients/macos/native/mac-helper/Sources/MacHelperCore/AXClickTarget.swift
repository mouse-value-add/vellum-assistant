import CoreGraphics

/// Deciding whether a click by element ID still lands on that element.
///
/// **This exists because an element ID is a promise about the past.** The
/// model picks an ID from an observation, and the click goes to the centre of
/// the frame that observation recorded. Between the two the window can scroll,
/// a list can gain a row, a sheet can open over it, or an earlier action in a
/// batch can change the page. The click then lands on whatever is there now,
/// and reports success.
///
/// So just before the click, the helper asks accessibility what is under that
/// point and hands the answer here as a chain: the hit element first, then its
/// ancestors. The rule is to refuse only on evidence. Some apps answer a hit
/// test coarsely (a web view can return a wrapper group with nothing
/// actionable in it), and refusing there would make those apps unclickable by
/// ID. A chain that shows nothing actionable proves nothing, so the click goes
/// ahead as it did before this check existed.
public enum AXClickTarget {
    /// What is known about one element: enough to tell whether two readings
    /// are the same control.
    public struct Element: Sendable, Equatable {
        public let role: String
        /// The name the element goes by, chosen as the tree walk chooses it.
        public let label: String?
        public let frame: CGRect
        /// Whether the model could have picked this element from a tree.
        public let actionable: Bool

        public init(role: String, label: String?, frame: CGRect, actionable: Bool) {
            self.role = role
            self.label = label
            self.frame = frame
            self.actionable = actionable
        }
    }

    public enum Verdict: Sendable, Equatable {
        /// The observed element, or something inside it, is under the point.
        case reachesTarget
        /// A different control is under the point. Carries it, so the refusal
        /// can say what the click would have hit.
        case differentElement(Element)
        /// The hit test showed nothing that settles it either way.
        case unknown
    }

    /// How much of the observed frame a reading must share with it to be the
    /// same element rather than a namesake. Half, measured as intersection
    /// over union: a layout that shifted a few points still passes, while a
    /// list that moved one row puts an identically named button over the
    /// point with no overlap at all.
    static let minimumOverlap: CGFloat = 0.5

    /// `hitChain` runs from the element under the point outwards through its
    /// ancestors. Nil or empty means the hit test did not answer.
    public static func verdict(target: Element, hitChain: [Element]?) -> Verdict {
        guard let hitChain, !hitChain.isEmpty else { return .unknown }
        if hitChain.contains(where: { isSame($0, as: target) }) {
            return .reachesTarget
        }
        // The nearest actionable element is the one a click would operate.
        if let found = hitChain.first(where: \.actionable) {
            return .differentElement(found)
        }
        return .unknown
    }

    static func isSame(_ reading: Element, as target: Element) -> Bool {
        guard reading.role == target.role, reading.label == target.label else {
            return false
        }
        // An element observed with no frame has nothing to compare against,
        // and it was clicked at the origin; identity is all there is.
        if target.frame.isEmpty { return true }
        return overlap(reading.frame, target.frame) >= minimumOverlap
    }

    /// Intersection over union of two rectangles, 0 when they do not meet.
    static func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let intersection = a.intersection(b)
        guard !intersection.isNull, !intersection.isEmpty else { return 0 }
        let shared = intersection.width * intersection.height
        let union = a.width * a.height + b.width * b.height - shared
        return union > 0 ? shared / union : 0
    }
}

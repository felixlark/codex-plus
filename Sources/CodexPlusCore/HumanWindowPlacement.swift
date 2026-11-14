import Foundation

public enum HumanWindowPlacementStep: Equatable {
    case resize(CGSize)
    case move(CGPoint)
    case ready
}

public enum HumanWindowPlacement {
    /// AX frame writes settle asynchronously. Issue one geometry operation per
    /// observation so a move cannot restore the pre-resize dimensions.
    public static func next(frame: CGRect, target: CGRect) -> HumanWindowPlacementStep {
        if abs(frame.width - target.width) >= 2 || abs(frame.height - target.height) >= 2 {
            return .resize(target.size)
        }
        if abs(frame.minX - target.minX) >= 2 || abs(frame.minY - target.minY) >= 2 {
            return .move(target.origin)
        }
        return .ready
    }
}

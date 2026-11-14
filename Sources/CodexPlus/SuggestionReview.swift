import Foundation
import SwiftUI
import CodexPlusCore

enum SuggestionAcceptance {
    private static var options: SuggestionAcceptanceOptions { .parse(CommandLine.arguments) }
    static var isRequested: Bool { options != .absent }
    static var isValidOrAbsent: Bool { options != .invalid }
    static var threadID: String? {
        if case .thread(let id) = options { return id }
        return nil
    }
}

struct SuggestionReview: Identifiable, Decodable {
    let id: String
    let snapshotId: String
    let title: String
    let text: String
    let sourceInput: String
    let reason: String
    let action: String
    let target: String
    let scope: String
    let canApprove: Bool
    let expiresAt: Double
}

struct SuggestionReviewList: View {
    @ObservedObject var launcher: CodexLauncher
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("待审建议（\(launcher.suggestionReviews.count)）").font(.headline)
            if launcher.suggestionReviews.isEmpty {
                Text("暂无待审建议。敏感或无法确认范围的建议会留在这里。")
                    .font(.callout).foregroundColor(.secondary)
            }
            ForEach(launcher.suggestionReviews) { review in
                VStack(alignment: .leading, spacing: 8) {
                    Text(review.title).font(.headline)
                    Text(review.reason).font(.callout).foregroundColor(.secondary)
                    Text("建议：\(review.text)").textSelection(.enabled)
                    Text("行动：\(review.action)\n对象：\(review.target)\n范围：\(review.scope)").font(.callout)
                    DisclosureGroup("查看来源输入") {
                        Text(review.sourceInput).font(.caption).textSelection(.enabled)
                    }
                    Text("批准仅适用于本次提示词；实际敏感动作仍须在原任务核对授权。过期或任务变化后失效。")
                        .font(.caption).foregroundColor(.secondary)
                    HStack {
                        Button("批准本次") { launcher.decideSuggestion(review, action: "approve") }
                            .disabled(!review.canApprove || launcher.reviewDecisions.contains(review.id))
                        Button("拒绝") { launcher.decideSuggestion(review, action: "reject") }
                            .disabled(launcher.reviewDecisions.contains(review.id))
                        Button("重新审查") { launcher.decideSuggestion(review, action: "retry") }
                            .disabled(launcher.reviewDecisions.contains(review.id))
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.08))
                .cornerRadius(8)
            }
            if let result = launcher.reviewResult { Text(result).font(.callout).foregroundColor(.secondary) }
        }
    }
}

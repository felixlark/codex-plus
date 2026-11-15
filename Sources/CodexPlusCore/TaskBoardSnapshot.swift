import Foundation

/// A read-only projection of taskd's registered cases. Run state never completes a case.
public struct TaskBoardSnapshot: Decodable {
    public let tasks: [Task]
    public struct Task: Decodable, Identifiable {
        public let repository: String
        public let number: Int
        public let input_revision: String
        public let paused: Bool
        public let coordination: Coordination
        public var id: String { "\(repository)#\(number)" }
        public var issueURL: URL { URL(string: "https://github.com/\(repository)/issues/\(number)")! }
        public var status: String { paused ? "paused" : coordination.status }
        public var visibleActions: [Action] {
            coordination.actions.filter { $0.input_revision == input_revision || $0.receipt != nil || ["prepared", "submitting", "queued", "running", "unknown", "waiting_decision", "waiting_dependency"].contains($0.state) }
        }
    }
    public struct Coordination: Decodable {
        public let status: String
        public let agent_id: String?
        public let updated_at: String
        public let actions: [Action]
    }
    public struct Action: Decodable, Identifiable {
        public let action_id: String
        public let host_id: String?
        public let input_revision: String
        public let thread_id: String?
        public let run_id: String?
        public let state: String
        public let receipt: String?
        public var id: String { action_id }
    }
    public static func decode(_ object: Any) throws -> Self {
        let value = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: object))
        guard value.tasks.allSatisfy({ $0.number > 0 && $0.repository.range(of: #"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil }),
              Set(value.tasks.map(\.id)).count == value.tasks.count else {
            throw NSError(domain: "TaskBoard", code: 1, userInfo: [NSLocalizedDescriptionKey: "任务身份重复或无效"])
        }
        return value
    }
    public var runningCount: Int { tasks.filter { $0.status == "running" }.count }
    public var attentionCount: Int { tasks.filter { ["waiting_decision", "waiting_dependency", "failed", "unassigned"].contains($0.status) }.count }
    public var completedCount: Int { tasks.filter { $0.status == "completed" }.count }
    public static func label(_ status: String) -> String {
        ["unassigned":"待分配", "ready":"就绪", "prepared":"已准备", "submitting":"提交中", "queued":"排队中",
         "running":"执行中", "finished":"运行结束", "unknown":"结果未知", "waiting_decision":"待决定",
         "waiting_dependency":"待依赖", "review":"待核验", "delivery":"交付中", "delivered":"已交付",
         "completed":"已完成", "failed":"失败", "cancelled":"已取消", "paused":"已暂停"][status] ?? "未知状态（\(status)）"
    }
}

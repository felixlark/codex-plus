import Foundation

public struct CodexTaskCatalog: Decodable {
    public let threads: [Thread]
    public let complete: Bool
    public let error: String?
    public let mappedHost: Host?
    public struct Host: Decodable { public let id: String; public let sourceCommit: String }
    public struct Thread: Decodable, Identifiable {
        public let id: String
        public let name: String
        public let parentThreadId: String?
        public let parentRunId: String?
        public let runId: String?
        public let status: String
        public let activeFlags: [String]
        public let unknown: Bool
        public var running: Bool { !unknown && status == "active" }
        public var attention: Bool { status == "systemError" || !activeFlags.isEmpty }
    }
}

/// This value combines observations, never persists task ownership or status.
public struct UnifiedTaskBoard {
    public struct Item: Identifiable {
        public let id: String
        public let task: TaskBoardSnapshot.Task?
        public let threads: [CodexTaskCatalog.Thread]
        public var name: String { task?.id ?? threads.first?.name ?? "Codex 会话" }
        public var running: Bool { task?.status == "running" || threads.contains(where: \.running) }
        public var attention: Bool {
            task.map { ["waiting_decision", "waiting_dependency", "failed", "unassigned"].contains($0.status) } == true || threads.contains(where: \.attention)
        }
        public var completed: Bool { task?.status == "completed" }
        public var pendingAssociation: Bool { task == nil && threads.contains { $0.unknown || $0.parentThreadId != nil } }
    }
    public let items: [Item]
    public let complete: Bool
    public init(tasks: TaskBoardSnapshot?, codex: CodexTaskCatalog?, expectedSourceCommit: String?) {
        let cases = tasks?.tasks ?? []
        var attached: [String: [CodexTaskCatalog.Thread]] = [:]
        var standalone: [CodexTaskCatalog.Thread] = []
        let mapped = codex?.mappedHost
        let host = mapped?.sourceCommit == expectedSourceCommit ? mapped?.id : nil
        for thread in codex?.threads ?? [] {
            let matches = cases.filter { task in
                task.coordination.actions.contains { action in
                    host != nil && action.host_id == host && action.thread_id == thread.id &&
                    thread.runId != nil && action.run_id == thread.runId && !thread.unknown
                }
            }
            if matches.count == 1 { attached[matches[0].id, default: []].append(thread) }
            else { standalone.append(thread) }
        }
        var result = cases.map { Item(id: $0.id, task: $0, threads: attached[$0.id] ?? []) }
        // A parent ID alone proves ancestry, not that both are doing the same Run.
        // Only an explicit parent Run may remove an otherwise independent item.
        for thread in standalone {
            if let parent = thread.parentThreadId, let parentRun = thread.parentRunId,
               let index = result.firstIndex(where: { $0.threads.contains { $0.id == parent && $0.runId == parentRun } }) {
                let item = result[index]
                result[index] = Item(id: item.id, task: item.task, threads: item.threads + [thread])
            } else { result.append(Item(id: "local:\(thread.id)", task: nil, threads: [thread])) }
        }
        items = result
        complete = tasks != nil && codex?.complete == true && codex?.error == nil && (cases.isEmpty || host != nil) && !result.contains(where: \.pendingAssociation)
    }
    public var runningCount: Int { items.filter(\.running).count }
    public var attentionCount: Int { items.filter(\.attention).count }
    public var completedCount: Int { items.filter(\.completed).count }
}

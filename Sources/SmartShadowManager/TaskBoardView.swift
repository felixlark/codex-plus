import SwiftUI
import CodexPlusCore

struct TaskBoardView: View {
    @StateObject private var model = TaskBoardModel()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("当前任务").font(.title2.bold())
                Spacer()
                Button("刷新") { model.refresh() }.disabled(model.busy)
            }
            Text("taskd 登记范围 · Codex 独立任务尚未计入").font(.caption).foregroundColor(.secondary)
            if let snapshot = model.snapshot {
                HStack(spacing: 18) {
                    count("总计", snapshot.tasks.count)
                    count("执行中", snapshot.runningCount)
                    count("待处理", snapshot.attentionCount)
                    count("已完成", snapshot.completedCount)
                }
                if snapshot.tasks.isEmpty { Text("当前登记范围没有任务").foregroundColor(.secondary) }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(snapshot.tasks) { task in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .top) {
                                    Link(task.id, destination: task.issueURL).lineLimit(2)
                                    Spacer()
                                    Text(TaskBoardSnapshot.label(task.status)).font(.callout)
                                }
                                ForEach(task.visibleActions) { action in
                                    HStack {
                                        Text(TaskBoardSnapshot.label(action.state)).font(.caption)
                                        if action.input_revision != task.input_revision { Text("输入版本已更新").font(.caption).foregroundColor(.secondary) }
                                        if action.thread_id == nil { Text("未绑定会话").font(.caption).foregroundColor(.secondary) }
                                        if let receipt = action.receipt, let url = URL(string: receipt), url.scheme == "https" {
                                            Link("成果", destination: url).font(.caption)
                                        }
                                    }
                                }
                            }
                            Divider()
                        }
                    }
                }
                if let date = model.updatedAt { Text("更新于 \(date.formatted(date: .omitted, time: .standard))").font(.caption).foregroundColor(.secondary) }
            } else if let error = model.error {
                Text(error).foregroundColor(.secondary)
            } else { ProgressView("读取 taskd…") }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(minWidth: 400, minHeight: 240)
        .onAppear { model.refresh() }
        .onDisappear { model.cancel() }
    }
    private func count(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) { Text("\(value)").font(.title2.monospacedDigit()); Text(title).font(.caption).foregroundColor(.secondary) }
    }
}

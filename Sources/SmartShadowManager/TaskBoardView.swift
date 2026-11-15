import SwiftUI
import CodexPlusCore

struct TaskBoardView: View {
    @ObservedObject var model: TaskBoardModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("当前任务").font(.title2.bold())
                Spacer()
                Button("刷新") { model.refresh() }.disabled(model.busy)
            }
            Text("taskd 登记事项 + 本机 Codex 当前工作").font(.caption).foregroundColor(.secondary)
            if model.updatedAt != nil {
                HStack(spacing: 18) {
                    count(model.board.complete ? "总计" : "暂列项", model.board.items.count)
                    count("执行中", model.board.runningCount)
                    count("待处理", model.board.attentionCount)
                    count("已完成", model.board.completedCount)
                }
                if model.board.items.isEmpty { Text("当前登记范围没有任务").foregroundColor(.secondary) }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(model.board.items) { item in
                          if let task = item.task {
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
                          } else {
                            HStack(alignment: .top) {
                                if let thread = item.threads.first,
                                   let url = URL(string: "codex://threads/\(thread.id)?hostId=local") {
                                    Link(item.name, destination: url).lineLimit(2)
                                } else { Text(item.name).lineLimit(2) }
                                Spacer()
                                Text(item.threads.contains(where: \.unknown) ? "状态未知" : item.attention ? "待处理" : "执行中").font(.callout)
                            }
                          }
                          if item.pendingAssociation { Text("关联待核实，暂单列").font(.caption).foregroundColor(.secondary) }
                          Divider()
                        }
                    }
                }
                if !model.board.complete { Text("来源或关联尚不完整，暂不提供精确总数").font(.caption).foregroundColor(.secondary) }
                if let error = model.error { Text("taskd：\(error)").font(.caption).foregroundColor(.secondary) }
                if let error = model.codexError { Text(error).font(.caption).foregroundColor(.secondary) }
                if let date = model.updatedAt { Text("更新于 \(date.formatted(date: .omitted, time: .standard))").font(.caption).foregroundColor(.secondary) }
            } else if let error = model.error {
                Text(error).foregroundColor(.secondary)
            } else { ProgressView("读取当前任务…") }
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

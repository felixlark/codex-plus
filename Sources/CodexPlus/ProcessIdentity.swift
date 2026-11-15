import Foundation
import Darwin

enum ProcessIdentity {
    static func read(_ pid: pid_t) -> [String: Any]? {
        guard pid > 0 else { return nil }
        var info = proc_bsdinfo()
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout.size(ofValue: info))) == MemoryLayout.size(ofValue: info),
              info.pbi_uid == getuid() else { return nil }
        return ["pid":pid, "start_seconds":info.pbi_start_tvsec, "start_microseconds":info.pbi_start_tvusec]
    }
}

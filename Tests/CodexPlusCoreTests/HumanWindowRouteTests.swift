import XCTest
@testable import CodexPlusCore

final class HumanWindowRouteTests: XCTestCase {
    func testMobileMarkerInOuterOrNativeInitialRouteIsExcluded() {
        for marker in ["/?codexPlusMobileAnchor=agent", "/local/thread?codexPlusMobileAnchor=agent", "/local/thread?x=1&codexPlusMobileAnchor=agent"] {
            var url = URLComponents(string: "app://-/index.html")!
            url.queryItems = [URLQueryItem(name: "initialRoute", value: marker)]
            XCTAssertFalse(HumanWindowRoute.isMain(url.url!))
        }
        XCTAssertFalse(HumanWindowRoute.isMain(URL(string: "app://-/index.html?codexPlusMobileAnchor=agent")!))
        XCTAssertTrue(HumanWindowRoute.isMain(URL(string: "app://-/index.html?initialRoute=%2Flocal%2Fthread%3FcodexPlusHumanWindow%3Dhuman")!))
        XCTAssertFalse(HumanWindowRoute.isMain(URL(string: "app://-/index.html?initialRoute=%2Fhotkey-window")!))
    }
}

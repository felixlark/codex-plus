import XCTest
@testable import CodexPlusCore

final class SuggestionAcceptanceOptionsTests: XCTestCase {
    func testAbsentKeepsNormalMode() {
        XCTAssertEqual(SuggestionAcceptanceOptions.parse(["CodexPlus", "--settings"]), .absent)
    }
    func testExplicitScopeNormalizesUUID() {
        XCTAssertEqual(SuggestionAcceptanceOptions.parse(["CodexPlus", "--suggestion-acceptance-thread", "A1111111-2222-4333-8444-555555555555"]), .thread("a1111111-2222-4333-8444-555555555555"))
        XCTAssertEqual(SuggestionAcceptanceOptions.parse(["--suggestion-acceptance-thread=A1111111-2222-4333-8444-555555555555"]), .thread("a1111111-2222-4333-8444-555555555555"))
    }
    func testInvalidOrMissingValueCannotBecomeNormalMode() {
        for args in [["--suggestion-acceptance-thread"], ["--suggestion-acceptance-thread", "bad"], ["--suggestion-acceptance-thread="], ["--suggestion-acceptance-thread=bad"], ["--suggestion-acceptance-thread", "--settings"]] {
            XCTAssertEqual(SuggestionAcceptanceOptions.parse(args), .invalid)
        }
    }
    func testDuplicateScopeCannotSilentlySelectOne() {
        XCTAssertEqual(SuggestionAcceptanceOptions.parse(["--suggestion-acceptance-thread", "a1111111-2222-4333-8444-555555555555", "--suggestion-acceptance-thread", "bad"]), .invalid)
    }
}
